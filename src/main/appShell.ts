import { userDataDir } from './paths.ts'
import { refreshModelStatus } from './modelStatus.ts'
import {
  app,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
  BrowserWindow
} from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import {
  createMascotWindow,
  getMascotWindow,
  hideMascot,
  isMascotHidden,
  seatMascotAt,
  setMascotHiddenListener,
  showMascot,
  toggleMascot
} from './mascot.ts'
import { mainPanelMenuLabel, mascotMenuLabel } from './mascotState.ts'
import { MainPanelController } from './mainPanel.ts'
import { hideBubble, openBubble } from './bubble.ts'
import { DETACH_MARGIN_PX, isOutsideBounds } from './freechatHost.ts'
import { addDevLog } from '../shared/devlog.ts'
import {
  placeWindowBox,
  readWindowState,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  writeWindowState,
  type WindowBox
} from './window-state.ts'
import { armRevealWatchdog, loadView, VIEWS, WEB_PREFS } from './atlasWindow.ts'
import { CH } from '../shared/ipcChannels.ts'
import type { FreechatHost } from '../shared/types.ts'

// ── Developer 日志窗口(第八十七锤):模型后台原话亮出来看 ──
// 独立小窗(frameless,和主窗一个壳),渲染层用 ?view=devlogs 分支画日志页。
// 引擎的每一行原话、每笔请求报账,广播员推给所有窗口,这窗常驻收听。

let devLogWindow: BrowserWindow | null = null

// ── 托盘常驻与单实例(桌宠托管第一锤,2026-09-18)──
// 收起模式的地基:主窗引用提升到模块级,托盘和 second-instance 都要够得着它。
export let mainWindowRef: BrowserWindow | null = null
export let mainPanelController: MainPanelController | null = null
let tray: Tray | null = null
// 真退出旗:托盘「退出」先立旗再 quit,close 事件看见旗才放行销毁 ——
// 不立旗的话关窗=收起,窗口永远走不到销毁那一步
let quitting = false

/** 把主窗带回前台:托盘「显示主面板」、左键点托盘、第二个实例敲门,都走这条 */
export function showMainWindow(): void {
  mainPanelController?.show()
}

// ── 小探针形态机(走出面板锤,2026-09-19 小葵拍板)──
// 自由对话一份内容两种形态:panel = 住在主面板页签(原始形态);pet = 变身桌宠趴桌面。
// 互斥铁律:同一时刻只显示一份。状态唯一事实源在这儿,广播出去各窗只管画自己。
// 桌宠不再是常驻宠物:对话住进桌宠时它才上岗,收回主面板它就下班。

let freechatHost: FreechatHost = 'panel'

/** 形态变了喊一声:主窗页签 ↔ 占位卡跟着换装(目前只有主窗订阅) */
function broadcastFreechatHost(): void {
  const win = mainWindowRef
  if (win && !win.isDestroyed()) win.webContents.send(CH.freechatHost, freechatHost)
}

/** 桌宠 lazy 上岗:没窗现建,有窗直接用(回收时只藏不销,再放出秒到位) */
function ensureMascot(): BrowserWindow {
  const win = getMascotWindow()
  if (win) return win
  return createMascotWindow(userDataDir())
}

/** 放出:页签拖出主窗松手 → 桌宠在松手点落座 + 自动弹一次气泡报「接到啦」。
 * force = 页签右键菜单点的「放到桌面」:不判窗外,桌宠落记忆位(没记忆按默认角),
 * 主面板顺手藏起来 —— 菜单点这句就是「人不要面板了」,拖放那条路不动。
 * 主窗渲染层已筛过「chat 品类且没钉住」,这里只做最后一步几何判定 */
export function detachFreechat(force = false): void {
  const win = mainWindowRef
  if (!win || win.isDestroyed() || freechatHost === 'pet') return
  const cursor = screen.getCursorScreenPoint()
  if (!force && !isOutsideBounds(win.getBounds(), cursor.x, cursor.y, DETACH_MARGIN_PX)) return
  freechatHost = 'pet'
  broadcastFreechatHost()
  if (force) mainPanelController?.hide()
  const pet = ensureMascot()
  if (!force) seatMascotAt(cursor.x, cursor.y)
  showMascot() // 假藏叫回:页面画回身体+穿透归轮询,不真 hide 那套(第五案)
  openBubble(pet.getBounds())
  addDevLog('system', '小探针走出面板,变身桌宠')
}

/** 收回:气泡头钮 / 占位卡 / 桌宠右键菜单三条路汇这一条 ——
 * 主窗亮 + 页签复活 + 气泡收 + 桌宠下班 */
export function dockFreechat(): void {
  if (freechatHost !== 'panel') {
    freechatHost = 'panel'
    broadcastFreechatHost()
  }
  hideBubble()
  hideMascot()
  showMainWindow()
}

/** 托盘图标:开发模式读仓库里的 build/icon.ico;打包后从 resources/app.ico 认
 * (electron-builder.yml 的 extraResources 负责把它搬进去) */
function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.ico')
    : join(app.getAppPath(), 'build/icon.ico')
}

/** 托盘菜单按当时真实状态下菜:主面板在屏上给「藏起它」,不在给「叫它出来」;
 * 桌宠同理(假藏后 isVisible 会说谎,问 mascotHidden 旗) */
function buildTrayMenu(): Menu {
  const mainShown = mainPanelController?.isShown() ?? false
  return Menu.buildFromTemplate([
    {
      label: mainPanelMenuLabel(mainShown),
      click: () => (mainShown ? mainPanelController?.hide() : showMainWindow())
    },
    { label: mascotMenuLabel(isMascotHidden()), click: () => toggleMascot() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
}

/** 主面板/桌宠露面状态一翻账就重摆菜单:别让人对着过期文案点菜 */
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
  setMascotHiddenListener(refreshTrayMenu)
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
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    show: false,
    webPreferences: WEB_PREFS
  })
  devLogWindow = win
  win.on('closed', () => {
    if (devLogWindow === win) devLogWindow = null
  })
  // 露窗三保险和主窗同一条链(工厂上弦):ready-to-show 快路 + 渲染层双 rAF 首帧信号
  // (按 sender 认窗,不抢主窗的信号)+ 3 秒看门狗,绝不永久隐身
  armRevealWatchdog(win, { firstFrame: 'shared' })
  loadView(win, VIEWS.devlogs)
}

export function createWindow(): void {
  // ── 第七十八锤:窗口尺寸记事本 ──
  // 上回把窗拉到多大、搁在哪儿,这回开窗就照旧;最大化单独记一票,还原时先落回上次的
  // 正常大小再最大化(最大化时 getBounds 是铺满屏的假尺寸,不能当正常尺寸记)。
  // 存档先过安检再落窗:垃圾存档走默认,旧存档对着现在的屏幕贴边夹紧(换屏/改分辨率
  // 也不把窗送出屏外)。记不住(读写失败)就当没这回事,走默认 —— 锦上添花不添乱。
  const savedWindowState = readWindowState(userDataDir())
  const placedBox = savedWindowState
    ? placeWindowBox(
        savedWindowState.box,
        screen.getAllDisplays().map((d) => d.workArea)
      )
    : null
  let normalBox: WindowBox | null = savedWindowState ? savedWindowState.box : null
  let stateSaveTimer: NodeJS.Timeout | null = null

  const mainWindow = new BrowserWindow({
    width: placedBox?.width ?? 1200,
    height: placedBox?.height ?? 800,
    ...(placedBox && placedBox.x !== undefined && placedBox.y !== undefined
      ? { x: placedBox.x, y: placedBox.y }
      : {}),
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    title: 'CodeAtlas',
    // 圆角悬浮壳回归(模块四):frame:false 摘系统框,transparent 让四角露出真实桌面,
    // 14px 圆角 + 悬浮阴影全由 CSS 画。系统级圆角(DWM roundedCorners)只有 Windows 11
    // (build 22000+)认,本机 Win10 19045 不认 —— 所以抗锯齿圆角只有透明合成这一条路。
    // 上次「窗隐身」的病根已查明:不是透明本身,而是 show:false 时 ready-to-show 在
    // 4K + 150% 缩放屏上永不触发(实底窗同样隐身,第三十六锤补实测)。这次 show:false
    // 只是为了等首帧防白闪,但绝不指望 ready-to-show —— 露窗走下面的三保险链。
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false, // 系统影子跟着方框走,会描出一圈直角细线;悬浮阴影改由 CSS 画圆角的
    autoHideMenuBar: true,
    show: false,
    webPreferences: WEB_PREFS
  })
  // 主窗引用上提(桌宠托管第一锤):托盘、second-instance 都要够得着它
  mainWindowRef = mainWindow
  mainPanelController = new MainPanelController(mainWindow)
  mainPanelController.onShownChange = refreshTrayMenu

  // 记事本落盘:平常拖大拖小/挪地方都是 debounce 攒 0.5 秒写一回,关窗那一刻清表补写;
  // 最大化时不记铺满屏的假尺寸,只记「是最大化」这一票
  const persistWindowState = (): void => {
    if (mainWindow.isDestroyed()) return
    writeWindowState(userDataDir(), {
      box: normalBox ?? mainWindow.getBounds(),
      maximized: mainWindow.isMaximized()
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
    // 收起模式(桌宠托管第一锤):点关闭 = 藏进托盘,程序继续跑、聊天继续在线、
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
  // 3) 加载完主动催一帧:万一合成器还醒着,别让它干等
  // 「接回横幅」:救生圈动过手(reload 完/GPU 重启完)就捎个信,让页面弹一句人话
  let revivePending = false
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.invalidate()
    // 顺手把模型状态问一轮:状态栏一开屏就有真话可说,不用干等轮询
    void refreshModelStatus().catch(() => {})
    if (revivePending) {
      revivePending = false
      mainWindow.webContents.send(CH.rendererRevived)
    }
  })
  // 救生圈(2026-09-13 小葵两次报案:「界面凭空消失,后台还开着」)。这窗是透明无边框的,
  // 渲染层一崩或 GPU 进程一打嗝重启,窗口就整窗透明 —— 看着像消失,其实进程全活着。
  // 渲染层真崩:记进后台账本(账本住主进程,渲染层死了也活着),reload 把页面重挂回来。
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    console.log(`[window] 渲染层断了(${details.reason}),自动重接`)
    addDevLog('system', `画面断了一次(渲染层 ${details.reason}),已自动重接 —— 页面回到刚打开的样子`)
    revivePending = true
    if (!mainWindow.isDestroyed()) mainWindow.webContents.reload()
  })
  // GPU 进程打嗝:页面本身是活的(实测 CPU/内存/连接全正常),只是透明窗再也等不来新画面。
  // 催一帧 + 藏了再亮,逼 DWM 重开一块新画布,页面状态(聊天/扫描结果)一分不丢。
  // Electron 44 起 GPU 的事件只挂在 app 级(child-process-gone),按 processType 认出 GPU 再动手
  const onGpuGone = (
    _event: Electron.Event,
    details: Electron.RenderProcessGoneDetails & { type: string }
  ): void => {
    if (details.type !== 'GPU' || details.reason === 'clean-exit') return
    console.log(`[window] GPU 进程断了(${details.reason}),重开画布`)
    addDevLog('system', `画面断了一次(GPU 进程 ${details.reason}),已自动重接 —— 你正在看的内容没丢`)
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.invalidate()
    if (mainWindow.isVisible()) {
      mainWindow.hide()
      mainWindow.show()
    }
    mainWindow.webContents.send(CH.rendererRevived)
  }
  app.on('child-process-gone', onGpuGone)
  mainWindow.on('closed', () => {
    app.removeListener('child-process-gone', onGpuGone)
  })
  // 卡死不拉黑:渲染层主线程僵住超过 10 秒记一笔,让后台账本有话可查(不动手,等它自己醒)
  mainWindow.webContents.on('unresponsive', () => {
    console.log('[window] 渲染层没响应了一阵')
    addDevLog('system', '画面卡住了一阵(渲染层没响应) —— 记一笔备查')
  })
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
  // ── 救生圈 2.0(第五案实测定性后立):隐身的真身是「渲染进程活着,画面管线却永久
  // 停摆」——实测这种状态下重画/藏亮/改尺寸全都叫不醒,唯一有效的解药是整页重挂
  // (重载后画面 100% 复活)。所以不再干等它自己醒:渲染层用 rAF 每秒报一跳
  // 「画面循环还在转」;窗明明露着、心跳却停了 10 秒以上,主进程直接 reload 重挂管线,
  // 自动满血,不用小葵按任何键。心跳同时是常驻取证:rAF 停没停,后台账本里看得见。
  // 只认主窗发的跳(日志窗共用同一个渲染入口,别让它替主窗保平安)。
  let lastFrameBeat = Date.now()
  const onFrameBeat = (event: Electron.IpcMainEvent): void => {
    if (!mainWindow.isDestroyed() && event.sender === mainWindow.webContents)
      lastFrameBeat = Date.now()
  }
  ipcMain.on(CH.frameHeartbeat, onFrameBeat)
  const frameBeatWatchdog = setInterval(() => {
    if (mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return
    const gap = Date.now() - lastFrameBeat
    if (gap <= 10_000) return
    console.log(`[window] 画面心跳停了 ${gap}ms,自动整页重挂(救生圈2.0)`)
    addDevLog(
      'system',
      `画面管线停了约 ${Math.round(gap / 1000)} 秒,已自动重挂救回 —— 刚才没聊完的内容没能保住,抱歉`
    )
    revivePending = true
    lastFrameBeat = Date.now() // 重挂期间先续上账,免得看门狗连开两枪
    mainWindow.webContents.reload()
  }, 3_000)
  // 手动拉起(保底,两段式):第一按还是无损那套(重画 + 藏了再亮,聊天记录不丢);
  // 10 秒内连按第二下 = 无损招数全试过还没亮,直接整页重挂保命(实测唯一解药)。
  // 保命窗口 3 秒改 10 秒(2026-09-13 白屏案):小白遇到隐身第一下按完会先看一眼结果,
  // 3 秒根本来不及按第二下 —— 那晚小葵连按三下全超时,保命招一次都没触发过。
  const HOTKEY_ARM_MS = 10_000
  let hotkeyArmed = false
  let hotkeyArmTimer: NodeJS.Timeout | null = null
  globalShortcut.register('CommandOrControl+Alt+0', () => {
    if (mainWindow.isDestroyed()) return
    if (hotkeyArmed) {
      if (hotkeyArmTimer) clearTimeout(hotkeyArmTimer)
      hotkeyArmed = false
      console.log('[window] 手动拉起第二按:整页重挂保命(Ctrl+Alt+0 ×2)')
      addDevLog('system', '手动拉起第二按:整页重挂保命(Ctrl+Alt+0 ×2)')
      revivePending = true
      mainWindow.webContents.reload()
      return
    }
    hotkeyArmed = true
    if (hotkeyArmTimer) clearTimeout(hotkeyArmTimer)
    hotkeyArmTimer = setTimeout(() => {
      hotkeyArmed = false
    }, HOTKEY_ARM_MS)
    console.log('[window] 手动拉起画面(Ctrl+Alt+0;还不亮就 10 秒内再按一次整页重挂)')
    addDevLog('system', '手动拉起画面(Ctrl+Alt+0;画面还是不亮的话,10 秒内再按一次整页重挂)')
    mainWindow.webContents.invalidate()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.hide()
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) mainWindow.show()
    }, 120)
  })
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null
      mainPanelController = null
    }
    clearInterval(modelStatusTimer)
    clearInterval(repaintHeartbeat)
    clearInterval(frameBeatWatchdog)
    ipcMain.removeListener(CH.frameHeartbeat, onFrameBeat)
    if (hotkeyArmTimer) clearTimeout(hotkeyArmTimer)
    globalShortcut.unregister('CommandOrControl+Alt+0')
    // 主窗走了,Developer 日志窗没有独活的意义:一起带走,应用照常退出
    if (devLogWindow && !devLogWindow.isDestroyed()) devLogWindow.close()
  })

  // 最大化是两副面孔:贴满屏幕时圆角描边必须收掉,四角才不漏出怪缝 —— 状态一变就喊渲染进程换装
  const syncMaximized = (maximized: boolean): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CH.windowMaximized, maximized)
  }
  mainWindow.on('maximize', () => syncMaximized(true))
  mainWindow.on('unmaximize', () => syncMaximized(false))

  // 外部链接交给系统浏览器打开,不在应用里开新窗口;只放行 http(s)/mailto ——
  // file:// 这类进系统 handler 等于替页面拉起本地程序,畸形串直接当没听见
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const { protocol } = new URL(details.url)
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
        void shell.openExternal(details.url)
      }
    } catch {
      /* 畸形地址:拒开 */
    }
    return { action: 'deny' }
  })

  // 开发模式加载 Vite 开发服务器,打包后加载本地文件(工厂代跑;主窗不带 ?view=,默认页就是它)
  loadView(mainWindow)

  // 验收探针(只在设置了 ATLAS_PROBE_DIR 时启用):露窗后截整窗图 + 记账再退出,
  // 专门伺候「100%/125%/150% 三档缩放实测」当证据;正常跑应用完全不碰这段
  const probeDir = process.env['ATLAS_PROBE_DIR']
  if (probeDir) {
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500)) // 露窗后再稳两秒半,让画面完全落定
      const scale = await mainWindow.webContents
        .executeJavaScript('String(window.devicePixelRatio)')
        .catch(() => 'unknown')
      const image = await mainWindow.webContents.capturePage().catch(() => null)
      const png = image ? image.toPNG() : Buffer.alloc(0)
      const report = {
        devicePixelRatio: scale,
        shownVia,
        visible: mainWindow.isVisible(),
        maximized: mainWindow.isMaximized(),
        bounds: mainWindow.getBounds(),
        pngBytes: png.length
      }
      await fs.mkdir(probeDir, { recursive: true })
      await fs.writeFile(join(probeDir, `probe-dpr${scale}.json`), JSON.stringify(report, null, 2))
      if (png.length > 0) await fs.writeFile(join(probeDir, `probe-dpr${scale}.png`), png)
      app.quit()
    })()
  }
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
