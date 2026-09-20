// ── 桌宠的对话气泡(右键问一问,2026-09-18;桌宠气泡锤 2026-09-19)──
// 桌宠旁边弹出的聊天小窗,装的只有共享自由对话一种形态 ——
// 会话正主在主窗渲染层(公用场 useAiChat),气泡是影子窗:看快照、输入转回去,
// 全 app 一场对话,主窗发的气泡看得见,气泡发的进主窗账本。
// (右键问一问/划词问一问已下线:文件/划词两种形态连同待处理内容机制一并拆走)

import { app, BrowserWindow, ipcMain, screen } from 'electron'
import type { Rectangle } from 'electron'
import { join } from 'node:path'
import { addDevLog } from '../shared/devlog.ts'
import { placeBubbleBox, BUBBLE_WIDTH, BUBBLE_HEIGHT } from './bubblePlacement.ts'

let bubbleWindow: BrowserWindow | null = null

/** 没拿到桌宠位置时的兜底落点:屏幕右下角(桌宠激活正常都带着 bounds 来) */
function bubbleBounds(): { x: number; y: number; width: number; height: number } {
  const wa = screen.getPrimaryDisplay().workArea
  return { x: wa.x + wa.width - BUBBLE_WIDTH - 24, y: wa.y + wa.height - BUBBLE_HEIGHT - 180, width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT }
}

/** 开气泡:贴桌宠落位;已开着就按当下位置重贴、唤到前台 */
export function openBubble(anchor?: Rectangle): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    // 已开着的气泡:唤到前台,顺带重贴一遍 —— 桌宠可能被拖走过,气泡不能落回老地方
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
  addDevLog('system', '气泡弹开:自由对话')
}

/** 点桌宠的开关语义(桌宠气泡锤):开着就藏起来(会话在主窗账本上,藏窗不丢话);
 * 关着/没有就贴桌宠弹出来 */
export function toggleBubble(anchor?: Rectangle): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible()) {
    bubbleWindow.hide()
    return
  }
  openBubble(anchor)
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
}
