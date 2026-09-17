// ── 桌宠的对话气泡(右键问一问,2026-09-18)──
// 资源管理器右键文件 → 「问问小探针」→ 桌宠旁边弹出的聊天小窗。
// 换皮不换脑:里面复用自由聊天的后端(useAiChat → aiChat),只换一副小窗的皮。
// 出界文件策略(已拍板):文件在当前项目内 = 正常问答(agent 可翻文件);
// 在项目外 = 人话提示 + 「把它的文件夹设为工作目录」按钮;不点也能就文件本身聊
// (主进程读文件内容当资料附上 —— 用户右键点名了这个文件,就是授权读它)。

import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promises as fs } from 'node:fs'
import { addDevLog } from '../shared/devlog.ts'
import { sniffBinaryKind } from '../ai/index.ts'

let bubbleWindow: BrowserWindow | null = null
/** 右键带来的待处理文件:气泡窗 ready 后用 invoke 拉走(取走即清,不重弹) */
let pendingFilePath: string | null = null

/** 单文件聊的内容上限:字符数。再长的文件只带开头,人话说清楚 */
const BUBBLE_FILE_CHARS = 60_000
/** 只读文件头的字节数(判二进制/防超大文件爆内存) */
const BUBBLE_READ_HEAD_BYTES = 512

/** 气泡窗弹开的位置:屏幕右下角,桌宠的邻居 */
function bubbleBounds(): { x: number; y: number; width: number; height: number } {
  const wa = screen.getPrimaryDisplay().workArea
  const width = 360
  const height = 480
  return { x: wa.x + wa.width - width - 24, y: wa.y + wa.height - height - 180, width, height }
}

/** 带文件开气泡:主进程 second-instance / 冷启动都走这条 */
export function openBubbleForFile(filePath: string): void {
  pendingFilePath = filePath
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    // 已开着的气泡:换一份新文件,唤到前台
    bubbleWindow.webContents.send('atlas:bubble-file-changed')
    bubbleWindow.show()
    bubbleWindow.focus()
    return
  }
  const box = bubbleBounds()
  const win = new BrowserWindow({
    ...box,
    minWidth: 300,
    minHeight: 360,
    title: '问问小探针 · CodeAtlas',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
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
  addDevLog('system', `气泡弹开:${basename(filePath)}`)
}

/** 气泡自己的通道(invoke 配 handle、send 配 on,收发成对) */
export function registerBubbleIpc(getCurrentRoot: () => string | null): void {
  // 气泡窗 ready 后拉走待处理文件 + 现场分辨「在不在当前项目里」+ 读出内容。
  // 每次都答当前 pending(取走即清);没 pending 回 null(窗开着但没新文件)
  ipcMain.handle('atlas:bubble-open', async () => {
    const filePath = pendingFilePath
    pendingFilePath = null
    if (!filePath) return null
    const root = getCurrentRoot()
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
    return { path: filePath, fileName: basename(filePath), folder: dirname(filePath), inProject, relPath, rootPath: root, content, readNote }
  })
}
