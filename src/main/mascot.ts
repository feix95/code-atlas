// ── 桌宠窗(桌宠托管第二锤,2026-09-18)──
// 收起模式的门面:屏幕角落一只小桌宠,聊天不中断,随叫随到,不用了就当它不存在。
// 透明无边框窗照主窗的方抓药(frame:false + transparent + 软件渲染全局生效);
// 动画按小葵拍板先走临时形状动画(CSS 画的小圆生物),正式素材画好后直接替换,机制不动。
// 桌宠只管壳,脑(agent 后端)一动不动 —— 忙闲状态听现成的模型广播(atlas:model-status)。

import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { addDevLog } from '../shared/devlog.ts'
import { MASCOT_SIZE, placeMascotBox, readMascotState, writeMascotState } from './mascotState.ts'

let mascotWindow: BrowserWindow | null = null
let mascotStateDir = ''

/** 建桌宠窗:位置有档照档(夹回屏内),没档落主屏右下角 */
export function createMascotWindow(stateDir: string): BrowserWindow {
  mascotStateDir = stateDir
  const saved = readMascotState(stateDir)
  const box = placeMascotBox(saved, screen.getAllDisplays().map((d) => d.workArea))
  const win = new BrowserWindow({
    width: box.width,
    height: box.height,
    ...(box.x !== undefined && box.y !== undefined ? { x: box.x, y: box.y } : {}),
    title: 'CodeAtlas 桌宠',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // 点桌宠唤主面板,自己不抢焦点:桌宠是门面不是主角
    focusable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 呼吸/眨眼这些小动画不能被后台节流憋死
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'floating')
  // 初始整窗穿透:空白处点的是桌面;渲染层 mousemove 报「在小家伙身上」才收回来
  win.setIgnoreMouseEvents(true, { forward: true })
  // 露窗走主窗同一条经验的简化版:ready-to-show 快路 + 3 秒看门狗,绝不永久隐身
  let shown = false
  const showOnce = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
  }
  win.once('ready-to-show', showOnce)
  setTimeout(showOnce, 3000)
  win.on('closed', () => {
    if (mascotWindow === win) mascotWindow = null
  })
  loadMascotPage(win)
  mascotWindow = win
  addDevLog('system', '桌宠上岗')
  return win
}

function loadMascotPage(win: BrowserWindow): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('view', 'mascot')
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'mascot' } })
  }
}

/** 托盘「显示·隐藏桌宠」:切可见性;隐藏后桌面干干净净,从托盘随时找回 */
export function toggleMascot(): void {
  const win = mascotWindow
  if (!win || win.isDestroyed()) return
  if (win.isVisible()) win.hide()
  else win.show()
}

/** 桌宠自己的通道(send 配 ipcMain.on,收发成对):
 * 穿透开关、拖动三连、点击唤主面板。点击唤谁由主进程注入,桌宠模块不回头依赖 index.ts */
export function registerMascotIpc(handlers: { onActivate: () => void }): void {
  // 渲染层 mousemove 几何判定「光标在不在这只小家伙身上」,报过来切穿透
  ipcMain.on('atlas:mascot-mouse', (event, inside: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || typeof inside !== 'boolean') return
    win.setIgnoreMouseEvents(!inside, { forward: true })
  })
  // 拖动三连:按下记抓手(光标到窗左上角的偏移),移动时光标走到哪儿窗跟到哪儿,
  // 松手存档。窗始终贴着光标挪,光标永远相对窗内,mousemove 不会半路丢
  let grab = { dx: MASCOT_SIZE / 2, dy: MASCOT_SIZE / 2 }
  ipcMain.on('atlas:mascot-drag-start', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const [wx, wy] = win.getPosition()
    const cursor = screen.getCursorScreenPoint()
    grab = { dx: cursor.x - wx, dy: cursor.y - wy }
  })
  ipcMain.on('atlas:mascot-drag-move', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    win.setPosition(cursor.x - grab.dx, cursor.y - grab.dy)
  })
  ipcMain.on('atlas:mascot-drag-end', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    writeMascotState(mascotStateDir, { x, y })
  })
  // 点击本体 = 唤回主面板(带焦点)
  ipcMain.on('atlas:mascot-activate', () => handlers.onActivate())
}
