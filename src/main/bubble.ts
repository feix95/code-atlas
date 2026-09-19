// ── 桌宠的对话气泡(右键问一问,2026-09-18;桌宠气泡锤 2026-09-19)──
// 资源管理器右键文件 → 「问问小探针」→ 桌宠旁边弹出的聊天小窗。
// 换皮不换脑:里面复用自由聊天的后端(useAiChat → aiChat),只换一副小窗的皮。
// 出界文件策略(已拍板):文件在当前项目内 = 正常问答(agent 可翻文件);
// 在项目外 = 人话提示 + 「把它的文件夹设为工作目录」按钮;不点也能就文件本身聊
// (主进程读文件内容当资料附上 —— 用户右键点名了这个文件,就是授权读它)。
// 桌宠气泡锤:左键点桌宠 = 气泡开/关切换,气泡里装的是主窗自由对话的镜像 ——
// 会话正主在主窗渲染层(公用场 useAiChat),气泡是影子窗:看快照、输入转回去,
// 全 app 一场对话,主窗发的气泡看得见,气泡发的进主窗账本。

import { app, BrowserWindow, ipcMain, screen } from 'electron'
import type { Rectangle } from 'electron'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promises as fs } from 'node:fs'
import { addDevLog } from '../shared/devlog.ts'
import { sniffBinaryKind } from '../ai/index.ts'
import { placeBubbleBox, BUBBLE_WIDTH, BUBBLE_HEIGHT } from './bubblePlacement.ts'

/** 待处理的气泡内容:右键问一问带来文件,划词问一问带来选中的文字,点桌宠来的是共享自由对话 */
export type BubblePending = { kind: 'file'; path: string } | { kind: 'text'; text: string } | { kind: 'chat' }

let bubbleWindow: BrowserWindow | null = null
/** 待处理内容:气泡窗 ready 后用 invoke 拉走(取走即清,不重弹) */
let pending: BubblePending | null = null

/** 单文件聊的内容上限:字符数。再长的文件只带开头,人话说清楚 */
const BUBBLE_FILE_CHARS = 60_000
/** 只读文件头的字节数(判二进制/防超大文件爆内存) */
const BUBBLE_READ_HEAD_BYTES = 512

/** 气泡窗弹开的位置:屏幕右下角,桌宠的邻居(右键/划词入口的默认落点) */
function bubbleBounds(): { x: number; y: number; width: number; height: number } {
  const wa = screen.getPrimaryDisplay().workArea
  return { x: wa.x + wa.width - BUBBLE_WIDTH - 24, y: wa.y + wa.height - BUBBLE_HEIGHT - 180, width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT }
}

/** 带内容开气泡:文件(右键问一问)、划词文本(划词问一问)、共享自由对话(点桌宠)共用一扇窗。
 * anchor = 桌宠 bounds:点桌宠来的气泡贴桌宠落位,没 anchor 走默认右下角 */
export function openBubble(content: BubblePending, anchor?: Rectangle): void {
  pending = content
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    // 已开着的气泡:换一份新内容,唤到前台。
    // 带 anchor 来的(点桌宠)顺带重贴一遍 —— 桌宠可能被拖走过,气泡不能落回老地方
    bubbleWindow.webContents.send('atlas:bubble-file-changed')
    if (anchor) {
      const box = placeBubbleBox(anchor, screen.getAllDisplays().map((d) => d.workArea))
      // setBounds 连尺寸钉死,不裸 setPosition(150% 缩放下逐像素生长,雷区档案②)
      bubbleWindow.setBounds({ x: box.x, y: box.y, width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT })
    }
    bubbleWindow.show()
    bubbleWindow.focus()
    return
  }
  const box = anchor
    ? placeBubbleBox(anchor, screen.getAllDisplays().map((d) => d.workArea))
    : bubbleBounds()
  const win = new BrowserWindow({
    ...box,
    title: '问问小探针 · CodeAtlas',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    // 固定尺寸的弹出窗,resizable 必须关;挪窗一律走 setBounds 连尺寸钉死 ——
    // 150% 缩放下裸 setPosition 每调一次窗体长 1px(雷区档案②,气泡越拖越胀就是这病)
    resizable: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  bubbleWindow = win
  win.on('closed', () => {
    if (bubbleWindow === win) bubbleWindow = null
  })
  // 露窗照主窗的简化方抓药:ready-to-show 快路 + 3 秒看门狗
  let shown = false
  const showOnce = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    // 露面即把尺寸钉回名义值:透明窗出生就可能被系统喂胖几像素(雷区档案②)
    win.setContentSize(BUBBLE_WIDTH, BUBBLE_HEIGHT)
    win.show()
    win.focus()
  }
  win.once('ready-to-show', showOnce)
  setTimeout(showOnce, 3000)
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('view', 'bubble')
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'bubble' } })
  }
  addDevLog(
    'system',
    `气泡弹开:${content.kind === 'file' ? basename(content.path) : content.kind === 'text' ? `划词(${content.text.length} 字)` : '自由对话'}`
  )
}

/** 点桌宠的开关语义(桌宠气泡锤):开着就藏起来(会话在主窗账本上,藏窗不丢话);
 * 关着/没有就贴桌宠弹出来 */
export function toggleBubble(content: BubblePending, anchor?: Rectangle): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible()) {
    bubbleWindow.hide()
    return
  }
  openBubble(content, anchor)
}

/** 桌宠拖拽落定后气泡归位(跟随降频,雷区档案):拖动途中气泡原地不动,
 * 松手那刻照桌宠最终落点挪一次 —— 每帧都追的活体跟随被砍了:
 * 透明无边框窗 + 高频程序挪窗 = 挪窗回声 + 窗体膨胀,一场病一串症。
 * 气泡开着才挪;藏着的不用管 —— 再点开时 toggle/open 会按当下位置重贴 */
export function followBubble(anchor: Rectangle): void {
  if (!bubbleWindow || bubbleWindow.isDestroyed() || !bubbleWindow.isVisible()) return
  const box = placeBubbleBox(anchor, screen.getAllDisplays().map((d) => d.workArea))
  const [cx, cy] = bubbleWindow.getPosition()
  if (cx !== box.x || cy !== box.y) {
    // setBounds 连尺寸钉死(雷区档案②);归位一次只挪这一回
    bubbleWindow.setBounds({ x: box.x, y: box.y, width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT })
  }
}

/** 气泡收起来(走出面板锤):对话收回主面板时气泡跟着消失。
 * 只藏不销:再点桌宠时按当下位置重贴秒开 */
export function hideBubble(): void {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return
  bubbleWindow.hide()
}

/** 气泡自己的通道(invoke 配 handle、send 配 on,收发成对)。
 * 共享自由对话的三条链路:
 *  - 主窗 send mirror → 主进程缓存 + 转发气泡(push);
 *  - 气泡 invoke pull → 拉走最新快照(开窗即追平,不用等下一次变化);
 *  - 气泡 send input → 主进程转给主窗渲染层,那边的 useAiChat 干活。 */
export function registerBubbleIpc(deps: {
  getCurrentRoot: () => string | null
  getMainWindow: () => BrowserWindow | null
  /** 收回小探针(走出面板锤):主窗亮 + 页签复活 + 气泡收 + 桌宠下班,一条链路 */
  dock: () => void
}): void {
  /** 最新一份会话快照:气泡开窗先拉这个,之后吃增量推送 */
  let latestMirror: unknown = null
  // 主窗公用场 → 镜像:只认主窗发来的(别的窗冒名不收),快照换主进程推给气泡
  ipcMain.on('atlas:freechat-mirror', (event, messages: unknown) => {
    if (BrowserWindow.fromWebContents(event.sender) !== deps.getMainWindow()) return
    latestMirror = messages
    if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.webContents.send('atlas:freechat-push', messages)
  })
  // 气泡 → 主窗的输入:只认气泡窗发来的,转给主窗渲染层调 chat.send/cancel
  ipcMain.on('atlas:freechat-input', (event, payload: unknown) => {
    if (BrowserWindow.fromWebContents(event.sender) !== bubbleWindow) return
    const main = deps.getMainWindow()
    if (main && !main.isDestroyed()) main.webContents.send('atlas:freechat-input', payload)
  })
  // 「回主面板」:气泡头部按钮和主窗占位卡走同一条收回链路(走出面板锤)。
  // 只认这两扇窗发来的;以前只唤主窗不藏气泡 —— 气泡被盖在主窗背后,
  // 系统里还算开着,再点桌宠先执行「关」、要再点一下才开(小葵验收点的名)
  ipcMain.on('atlas:open-main', (event) => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    if (sender !== bubbleWindow && sender !== deps.getMainWindow()) return
    deps.dock()
  })
  ipcMain.handle('atlas:freechat-pull', () => latestMirror)
  // 气泡窗 ready 后拉走待处理内容(取走即清;没 pending 回 null = 窗开着但没新活)。
  // 文件:现场分辨「在不在当前项目里」+ 读出内容;划词文本:原样带过;chat:共享对话形态
  ipcMain.handle('atlas:bubble-open', async () => {
    const item = pending
    pending = null
    if (!item) return null
    if (item.kind === 'chat') return { kind: 'chat' as const }
    if (item.kind === 'text') return { kind: 'text' as const, text: item.text }
    const filePath = item.path
    const root = deps.getCurrentRoot()
    let inProject = false
    let relPath = ''
    if (root) {
      const rel = relative(root, filePath)
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
        inProject = true
        relPath = rel.split(sep).join('/')
      }
    }
    let content: string | null = null
    let readNote: string | undefined
    try {
      const head = await fs.readFile(filePath).then((buf) => buf.subarray(0, BUBBLE_READ_HEAD_BYTES))
      if (sniffBinaryKind(head, basename(filePath))) {
        readNote = '这是个二进制文件(程序/图片/压缩包这类),内容没法直接当话聊,但可以聊聊它是干嘛的。'
      } else {
        const full = await fs.readFile(filePath, 'utf8')
        content =
          full.length > BUBBLE_FILE_CHARS ? `${full.slice(0, BUBBLE_FILE_CHARS)}\n……(文件太长,只带了开头一部分)` : full
      }
    } catch {
      readNote = '这个文件现在读不出来(可能被挪走、删了,或者没有权限),先聊聊它是什么也行。'
    }
    return {
      kind: 'file' as const,
      path: filePath,
      fileName: basename(filePath),
      folder: dirname(filePath),
      inProject,
      relPath,
      rootPath: root,
      content,
      readNote
    }
  })
}
