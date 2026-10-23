import { userDataDir } from './paths.ts'
import { refreshModelStatus } from './modelStatus.ts'
import { app, Menu, nativeImage, screen, Tray, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mainPanelMenuLabel, MainPanelController } from './mainPanel.ts'
import { installAuxWindowBridge } from './auxWindows.ts'
import { addDevLog } from '../shared/devlog.ts'
import {
  baseWindowBox,
  physicalWindowBox,
  placeWindowBox,
  readWindowState,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  writeWindowState,
  type WindowBox
} from './window-state.ts'
import { armRevealWatchdog, loadView, VIEWS, WEB_PREFS } from './atlasWindow.ts'
import { trackWindowBackground, windowCanvasColor } from './windowTheme.ts'
import { installWindowRescue } from './windowRescue.ts'
import { runAcceptanceProbe } from './windowProbe.ts'
import { CH } from '../shared/ipcChannels.ts'

// ── Developer 日志窗口(第八十七批):模型后台原话亮出来看 ──
// 独立小窗(frameless,和主窗一个实底壳),渲染层用 ?view=devlogs 分支画日志页。
// 引擎的每一行原话、每笔请求用量,广播员推给所有窗口,这窗常驻收听。

let devLogWindow: BrowserWindow | null = null

// ── 托盘常驻与单实例(桌宠托管第一批,2026-09-18)──
// 收起模式的地基:主窗引用提升到模块级,托盘和 second-instance 都要够得着它。
export let mainWindowRef: BrowserWindow | null = null
export let mainPanelController: MainPanelController | null = null
let tray: Tray | null = null
// 真退出旗:托盘「退出」先立旗再 quit,close 事件看见旗才放行销毁 ——
// 不立旗的话关窗=收起,窗口永远走不到销毁那一步
let quitting = false

// 界面缩放系数的主进程状态表(UI 重构 v3·§2.2):窗口记事本记「100% 基准值」,
// 落盘/落窗都要拿它换算。渲染层 setUiScale 落盘后走 atlas:ui-scale-sync 报进来;
// 初值取上次存档里记的 scale —— 应用关着的时候缩放不可能变,这个值就是准的
let currentUiScale = 1

/** 渲染层报缩放(ipcShell 的 uiScaleSync 监听调):记账系数跟着换 */
export function setUiScaleFactor(v: number): void {
  currentUiScale = v
}

/** 把主窗带回前台:托盘「显示主面板」、左键点托盘、第二个实例敲门,都走这条 */
export function showMainWindow(): void {
  mainPanelController?.show()
}

/** 托盘图标:开发模式读仓库里的 build/icon.ico;打包后从 resources/app.ico 认
 * (electron-builder.yml 的 extraResources 负责把它搬进去) */
function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.ico')
    : join(app.getAppPath(), 'build/icon.ico')
}

/** 托盘菜单按当时真实状态下菜:主面板在屏上给「藏起它」,不在给「叫它出来」 */
function buildTrayMenu(): Menu {
  const mainShown = mainPanelController?.isShown() ?? false
  return Menu.buildFromTemplate([
    {
      label: mainPanelMenuLabel(mainShown),
      click: () => (mainShown ? mainPanelController?.hide() : showMainWindow())
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
}

/** 主面板露面状态一翻账就重摆菜单:别让人点选过期菜单项 */
function refreshTrayMenu(): void {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu())
}

export function createTray(): void {
  const icon = nativeImage.createFromPath(trayIconPath())
  if (icon.isEmpty())
    addDevLog('system', '托盘图标没加载出来(文件缺失?),托盘会显示默认空白图 —— 不影响功能')
  tray = new Tray(icon)
  tray.setToolTip('CodeAtlas')
  tray.setContextMenu(buildTrayMenu())
  // Windows 惯例:左键点托盘 = 唤回主面板
  tray.on('click', () => showMainWindow())
}

export function openDevLogWindow(): void {
  if (devLogWindow && !devLogWindow.isDestroyed()) {
    devLogWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 780,
    height: 560,
    minWidth: 560,
    minHeight: 380,
    title: 'Developer 日志 · CodeAtlas',
    autoHideMenuBar: true,
    frame: false,
    // 实底壳(全窗实底化):底色跟画布同色,建窗一刻就不闪异色
    backgroundColor: windowCanvasColor(),
    show: false,
    webPreferences: WEB_PREFS
  })
  devLogWindow = win
  trackWindowBackground(win)
  win.on('closed', () => {
    if (devLogWindow === win) devLogWindow = null
  })
  // 露窗三保险和主窗同一条链(工厂上弦):ready-to-show 快路 + 渲染层双 rAF 首帧信号
  // (按 sender 认窗,不抢主窗的信号)+ 3 秒看门狗,绝不永久隐身
  armRevealWatchdog(win, { firstFrame: 'shared' })
  loadView(win, VIEWS.devlogs)
}

export function createWindow(): void {
  // ── 第七十八批:窗口尺寸记事本 ──
  // 上回把窗拉到多大、搁在哪儿,这回开窗就照旧;最大化单独记一票,还原时先落回上次的
  // 正常大小再最大化(最大化时 getBounds 是铺满屏的假尺寸,不能当正常尺寸记)。
  // 存档先过安检再落窗:垃圾存档走默认,旧存档对着现在的屏幕贴边夹紧(换屏/改分辨率
  // 也不把窗送出屏外)。记不住(读写失败)就当没这回事,走默认 —— 锦上添花不添乱。
  // 存档记的是 100% 基准值(UI 重构 v3):乘回 scale 得物理框再贴屏落位;
  // 老存档没有 scale 字段 = 当年按物理像素记的,physicalWindowBox 原样奉还
  const savedWindowState = readWindowState(userDataDir())
  if (savedWindowState?.scale) currentUiScale = savedWindowState.scale
  const savedBox = savedWindowState ? physicalWindowBox(savedWindowState) : null
  const placedBox = savedBox
    ? placeWindowBox(
        savedBox,
        screen.getAllDisplays().map((d) => d.workArea)
      )
    : null
  let normalBox: WindowBox | null = savedBox
  let stateSaveTimer: NodeJS.Timeout | null = null

  // 关掉默认应用菜单:它的 Edit 角色带着系统加速键(Ctrl+Z/X/C/V/Y),
  // 真键盘按键会先被菜单角色截走,渲染进程的 keydown 收不到——工作台的撤销/剪贴板
  // 快捷键全在自己手里跑,菜单栏本就 autoHideMenuBar 隐身,索性摘干净。
  // 已真机验证:恢复默认菜单后画完矩形 Ctrl+Z 不响应(自动化注键走 CDP 绕得过菜单,测不出来)
  Menu.setApplicationMenu(null)

  const mainWindow = new BrowserWindow({
    width: placedBox?.width ?? 1200,
    height: placedBox?.height ?? 800,
    ...(placedBox && placedBox.x !== undefined && placedBox.y !== undefined
      ? { x: placedBox.x, y: placedBox.y }
      : {}),
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    title: 'CodeAtlas',
    // 实底壳(全窗实底化,产品裁定):frame:false 摘系统框,底色钉成画布同色 —
    // 透明合成那套圆角悬浮壳退役,窗缘就是实色直角,影子交回系统描。
    // 「窗隐身」的老病根还在档案里:show:false 时 ready-to-show 在 4K + 150% 缩放屏上
    // 可能永不触发 —— 露窗不指望它,走下面的三保险链(first-frame + 看门狗)。
    frame: false,
    backgroundColor: windowCanvasColor(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: WEB_PREFS
  })
  trackWindowBackground(mainWindow)
  // 主窗引用上提(桌宠托管第一批):托盘、second-instance 都要够得着它
  mainWindowRef = mainWindow
  mainPanelController = new MainPanelController(mainWindow)
  mainPanelController.onShownChange = refreshTrayMenu
  // 独立子窗桥(页签独立窗口):渲染层 window.open 开同进程子窗 ——
  // 白名单放行 + 无边框定形 + frameName 注册表(供 auxWindowOp 代发窗口操作)
  installAuxWindowBridge(mainWindow)

  // 记事本落盘:平常拖大拖小/挪地方都是 debounce 攒 0.5 秒写一回,关窗那一刻清表补写;
  // 最大化时不记铺满屏的假尺寸,只记「是最大化」这一票
  const persistWindowState = (): void => {
    if (mainWindow.isDestroyed()) return
    // 落盘一律折回 100% 基准值 + 记下当时系数(规格 §2.2:140% 时物理尺寸也 ×1.4,
    // 换档重开,窗口相对 UI 的比例恒定);x/y 是屏幕物理坐标,不折
    writeWindowState(userDataDir(), {
      box: baseWindowBox(normalBox ?? mainWindow.getBounds(), currentUiScale),
      maximized: mainWindow.isMaximized(),
      scale: currentUiScale
    })
  }
  const scheduleWindowStateSave = (): void => {
    if (stateSaveTimer) clearTimeout(stateSaveTimer)
    stateSaveTimer = setTimeout(persistWindowState, 500)
  }
  const noteNormalBounds = (): void => {
    if (!mainWindow.isDestroyed() && !mainWindow.isMaximized()) normalBox = mainWindow.getBounds()
  }
  mainWindow.on('resize', () => {
    noteNormalBounds()
    scheduleWindowStateSave()
  })
  mainWindow.on('move', () => {
    noteNormalBounds()
    scheduleWindowStateSave()
  })
  mainWindow.on('maximize', scheduleWindowStateSave)
  mainWindow.on('unmaximize', () => {
    noteNormalBounds()
    scheduleWindowStateSave()
  })
  mainWindow.on('close', (event) => {
    if (stateSaveTimer) clearTimeout(stateSaveTimer)
    persistWindowState()
    // 收起模式(桌宠托管第一批):点关闭 = 藏进托盘,程序继续跑、聊天继续在线、
    // 任务栏和 Alt+Tab 里都不再有主窗。真退出只走托盘「退出」—— 它先立 quitting
    // 旗再 quit,close 事件看见旗才放行销毁
    if (!quitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })
  // 上回关窗时是最大化:先把存档的正常大小落好,再进最大化,圆角描边那条链照常接手
  if (savedWindowState?.maximized) mainWindow.maximize()

  // ── 露窗链(工厂上弦):多路信号抢跑 + 无条件看门狗,窗口绝不永久隐身 ──
  // 本机实测(模块四验收):ready-to-show 只在 GPU 缓存健康时才来 —— 缓存被另一个
  // 实例锁住(Gpu Cache Creation failed)或被污染时就永远装死;当年「窗隐身」就是
  // 两实例缓存大战 + show 眼巴巴等 ready-to-show 叠出来的。所以每一路都只当快路,
  // 谁都不许当唯一依靠,3 秒看门狗才是保底。
  // 主窗独占 first-frame 通道(exclusive):桌宠/气泡/日志窗共用同一个 preload 都发信号,
  // 不独占不过滤的话,小家伙的帧会替主窗「报平安」,提前露白窗才冤
  let shownVia = 'never'
  armRevealWatchdog(mainWindow, {
    firstFrame: 'exclusive',
    beforeShow: (_win, via) => {
      shownVia = via
      console.log(`[window] 露窗方式:${via}`)
    }
  })
  // 救生圈全套(崩溃重接 / GPU 重开画布 / 心跳看门狗 / 手动拉起)住在 windowRescue
  installWindowRescue(mainWindow)
  // 外接 LM Studio 没法订阅它的内部状态:低频去问(10 秒一轮,本地请求很轻);
  // 内置引擎靠播报员事件推,不占这个轮询
  const modelStatusTimer = setInterval(() => {
    void refreshModelStatus().catch(() => {})
  }, 10_000)
  // 5 秒心跳:强制重画一帧(第四案的自动补丁)。内容没变时这一下几乎零成本;
  // 但只要 Windows 合成器哪一下把透明窗掉了链子,最多 5 秒就有一帧新画递过去,
  // 窗口自己接上 —— 不用等小葵来报案。
  const repaintHeartbeat = setInterval(() => {
    if (mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return
    mainWindow.webContents.invalidate()
  }, 5_000)
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null
      mainPanelController = null
    }
    clearInterval(modelStatusTimer)
    clearInterval(repaintHeartbeat)
    // 主窗走了,Developer 日志窗没有独活的意义:一起带走,应用照常退出
    if (devLogWindow && !devLogWindow.isDestroyed()) devLogWindow.close()
  })

  // 最大化是两副面孔:贴满屏幕时圆角描边必须收掉,四角才不漏出怪缝 —— 状态一变就喊渲染进程换装
  const syncMaximized = (maximized: boolean): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CH.windowMaximized, maximized)
  }
  mainWindow.on('maximize', () => syncMaximized(true))
  mainWindow.on('unmaximize', () => syncMaximized(false))

  // 外部链接转系统浏览器 + window.open 白名单,统一进子窗桥那道总闸
  // (installAuxWindowBridge 里,175 行处已上弦;setWindowOpenHandler 只有一席,不能两头装)

  // 开发模式加载 Vite 开发服务器,打包后加载本地文件(工厂代跑;主窗不带 ?view=,默认页就是它)
  loadView(mainWindow)

  // 验收探针(只在设置了 ATLAS_PROBE_DIR 时启用)住在 windowProbe,正常跑应用完全不碰
  runAcceptanceProbe(mainWindow, shownVia)
}

/** 真退出旗的写口在 index 的 before-quit;旗本身跟着窗壳状态住这儿 */
export function setQuitting(v: boolean): void {
  quitting = v
}

/** 托盘摘帽:will-quit 从 index 喊过来,托盘对象不出本文件 */
export function disposeTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
