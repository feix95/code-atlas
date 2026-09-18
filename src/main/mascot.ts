// ── 桌宠窗(桌宠托管第二锤,2026-09-18)──
// 收起模式的门面:屏幕角落一只小桌宠,聊天不中断,随叫随到,不用了就当它不存在。
// 透明无边框窗照主窗的方抓药(frame:false + transparent + 软件渲染全局生效);
// 动画按小葵拍板先走临时形状动画(CSS 画的小圆生物),正式素材画好后直接替换,机制不动。
// 桌宠只管壳,脑(agent 后端)一动不动 —— 忙闲状态听现成的模型广播(atlas:model-status)。

import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron'
import { join } from 'node:path'
import { addDevLog } from '../shared/devlog.ts'
import { MASCOT_SIZE, mainPanelMenuLabel, mascotCursorInside, placeMascotBox, readMascotState, writeMascotState } from './mascotState.ts'

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
  // 桌宠渲染层的 console/报错也进 Developer 日志:小窗藏得深,犯病不能悄无声息
  win.webContents.on('console-message', (_e, _level, message) => {
    addDevLog('system', `桌宠页面:${message}`)
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
export function registerMascotIpc(handlers: {
  onActivate: () => void
  /** 主面板现在是不是在屏上(显示且没最小化):右键菜单第一项照它翻文案 */
  isMainVisible: () => boolean
  /** 把主面板收回托盘:右键菜单「隐藏主面板」的动作 */
  onHideMain: () => void
}): void {
  // 渲染层只上报光标的屏幕坐标(null = 光标已离开窗口),「在不在小家伙身上」
  // 由主进程拿窗的屏幕位置判定 —— 修「拖不动」:渲染层自己量的坐标可能和窗的
  // 真实位置对不上(坐标系岔子),导致它以为光标永远不在身上、穿透永远不摘。
  // 翻转才打日志,进出各一条,不刷屏。
  let lastInside: boolean | null = null
  // 拖动旗:按着的时候窗锁死实心、不判「在不在身上」—— 不修的话,判定拿窗的
  // 旧位置对光标的新位置,窗追在光标后面每步都判成「出界」,穿透一秒开合几十次:
  // 窗闪、松手信号漏进桌面(dragging 卡死、桌宠跟着光标满屏飘)。闪烁+漂移同根。
  let dragging = false
  ipcMain.on('atlas:mascot-mouse', (event, pos: unknown) => {
    if (dragging) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const inside = mascotCursorInside(win.getBounds(), pos)
    win.setIgnoreMouseEvents(!inside, { forward: true })
    if (inside !== lastInside) {
      lastInside = inside
      addDevLog('system', inside ? '桌宠:光标摸到小家伙,窗改实心可点可拖' : '桌宠:光标离开,窗恢复穿透')
    }
  })
  // 拖动三连:按下记抓手(光标到窗左上角的偏移),移动时光标走到哪儿窗跟到哪儿,
  // 松手存档。窗始终贴着光标挪,光标永远相对窗内,mousemove 不会半路丢
  let grab = { dx: MASCOT_SIZE / 2, dy: MASCOT_SIZE / 2 }
  ipcMain.on('atlas:mascot-drag-start', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    dragging = true
    win.setIgnoreMouseEvents(false) // 拖动全程实心,松手信号绝不漏
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
    dragging = false
    // 松手按当前光标位置补一次判定:还在身上保持实心,不在就恢复穿透
    const inside = mascotCursorInside(win.getBounds(), screen.getCursorScreenPoint())
    win.setIgnoreMouseEvents(!inside, { forward: true })
    lastInside = inside
    const [x, y] = win.getPosition()
    writeMascotState(mascotStateDir, { x, y })
  })
  // 点击本体 = 唤回主面板(带焦点)
  ipcMain.on('atlas:mascot-activate', () => handlers.onActivate())
  // 右键本体 = 弹快捷菜单:第一项看主面板在不在屏上下菜(在 = 藏起它,不在 = 叫它出来),
  // 再把自己藏起来、真退出 —— 在屏上还写「显示主面板」是废话,小葵验收点的名
  ipcMain.on('atlas:mascot-menu', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const mainVisible = handlers.isMainVisible()
    Menu.buildFromTemplate([
      {
        label: mainPanelMenuLabel(mainVisible),
        click: () => (mainVisible ? handlers.onHideMain() : handlers.onActivate())
      },
      { label: '隐藏桌宠(托盘可找回)', click: () => win.hide() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]).popup({ window: win })
  })
}
