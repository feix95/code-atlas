// ── 桌宠窗(桌宠托管第二锤,2026-09-18;走出面板锤移植主仓趟平版 2026-09-19)──
// 收起模式的门面:屏幕角落一只小桌宠,聊天不中断,随叫随到,不用了就当它不存在。
// 透明无边框窗照主窗的方抓药(frame:false + transparent + 软件渲染全局生效);
// 动画按小葵拍板先走临时形状动画(CSS 画的小圆生物),正式素材画好后换皮不换机制。
// 桌宠只管壳,脑(agent 后端)一动不动 —— 忙闲状态听现成的模型广播(atlas:model-status)。
// 「光标在不在小家伙身上」不靠渲染层报:主进程每秒 30 次轮询光标位置自己判
// (Electron 鼠标转发 hide/show 几次就断气,issue #30808,第三案后弃用 ——
//  主窗一被召唤焦点切换就断气,桌宠显示着却拖不动,回退实验二次实锤那是老架构的病)。
// 第五案定调:focusable:false 的窗在 Windows 上真 hide()→show() 一回,按下信号(mousedown)
// 就被系统吞掉再也到不了渲染层 —— 所以「藏起」只能假藏,真 hide 是断头路。
// 第六案补丁:setOpacity(0→1) 的假藏在软件渲染的透明窗上照样翻车 —— 全透明期合成链
// 停帧,叫回只还藏前旧帧,看着正常;一拖 setPosition 连环逼 DWM 重取帧,坏档链交出
// 全透明帧,整窗蒸发(小葵实测:藏过再拖就变透明)。治法:藏起让页面自己隐身
// (主进程发信,mascot 页不画身体),窗口透明度从头到尾不碰,合成链永不断档。
// 走出面板锤:桌宠 = 小探针页签的变身形态,lazy 上岗 —— 对话拖出主窗它才出生,
// 收回主面板它就假藏下班;下班再放出,落松手点(seatMascotAt)。
// ⚠ 平台雷区档案(小葵实测+黑匣子实锤,换了几场仗):Windows 上「透明无边框窗 + 高频
// 程序挪窗」处处是坑 —— ① 挪窗喂回声:setPosition 落原地也发「窗动了」假信号,
// 渲染层回一句「再挪一下」无限空转;② 逐像素生长:150% 缩放下 setPosition 每调一次
// 窗体长 1px(DIP↔物理像素取整偏差,黑匣子拍到 140x144→321x326),窗往右下长,
// 看着就是漂移+气泡膨胀+白圈 —— 治法:挪窗一律 setBounds 连尺寸钉死,绝不裸 setPosition;
// ③ 跟随一律降频到「松手归位」,别再加每帧都追的活体跟随。

import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron'
import type { Rectangle } from 'electron'
import { armRevealWatchdog, loadView, VIEWS, WEB_PREFS } from './atlasWindow.ts'
import { CH } from '../shared/ipcChannels.ts'
import { addDevLog } from '../shared/devlog.ts'
import { MASCOT_SIZE, mainPanelMenuLabel, mascotCursorInside, placeMascotBox, readMascotState, writeMascotState } from './mascotState.ts'

let mascotWindow: BrowserWindow | null = null
let mascotStateDir = ''
// 桌宠「藏没藏着」自己记账:藏起是假藏(页面隐身+穿透),窗其实还是 visible,
// 问 isVisible() 它会撒谎说一直在 —— 第五案后只能看这面旗
let mascotHidden = false
// 藏/露翻账喊一声旁听者:托盘菜单要照真实状态换文案
let onMascotHiddenChange: ((hidden: boolean) => void) | null = null

/** 桌宠现在藏没藏着(托盘菜单照它出文案) */
export function isMascotHidden(): boolean {
  return mascotHidden
}

/** 注册「藏/露翻账」旁听(托盘菜单刷新用) */
export function setMascotHiddenListener(fn: (hidden: boolean) => void): void {
  onMascotHiddenChange = fn
}

function emitMascotHidden(): void {
  onMascotHiddenChange?.(mascotHidden)
}

// ── 穿透状态由主进程轮询守着(「又拖不动」第三案)──
// 渲染层上报 + Electron 鼠标转发这条路被弃了:上游 issue #30808 确认转发本身就不可靠,
// hide/show/焦点切换几番之后它干脆断气 —— 小窗再也收不到鼠标动静,判定永远「没摸到」。
// 改法:不靠任何转发,主进程每秒 30 次拿「光标屏幕位置」对「窗的屏幕位置」自己判,
// 在就收穿透(实心可点可拖),走了放行(透明区点的是桌面)。稳定、可测、无状态污染。
// ⚠ setIgnoreMouseEvents 不带 forward:forward 会在系统里挂个鼠标钩子,
// 平白多一个可坏的中间态,判定已全在主进程,钩子没用就摘了。
// 曾怀疑它就是「藏过就拖不动」的病根,隔离实验推翻:真凶是 focusable:false + 真 hide/show
// (见文件头第五案);右键菜单照弹是 contextmenu 走的另一条路,跟钩子死活无关。
let dragging = false
let lastInside: boolean | null = null // null = 状态未知(藏起后),下一拍必重设
let hoverWatch: NodeJS.Timeout | null = null
const HOVER_POLL_MS = 33

function watchHover(win: BrowserWindow): void {
  if (hoverWatch) return
  hoverWatch = setInterval(() => {
    if (win.isDestroyed()) {
      stopHoverWatch()
      return
    }
    if (dragging) return // 拖动全程锁实心,不判定
    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    const inside = mascotCursorInside(bounds, cursor)
    if (inside === lastInside) return
    lastInside = inside
    win.setIgnoreMouseEvents(!inside)
    addDevLog(
      'system',
      inside
        ? `桌宠:光标(${cursor.x},${cursor.y})摸到,窗(${bounds.x},${bounds.y})改实心可点可拖`
        : `桌宠:光标(${cursor.x},${cursor.y})离开,窗(${bounds.x},${bounds.y})恢复穿透`
    )
  }, HOVER_POLL_MS)
}

function stopHoverWatch(): void {
  if (hoverWatch) {
    clearInterval(hoverWatch)
    hoverWatch = null
  }
  // 藏起时抹掉判定记忆:hide/show 后 Windows 窗口的鼠标状态不可信,
  // 叫回时轮询第一拍必须无条件重设一次,逼它回到正轨
  lastInside = null
}

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
    // 点桌宠弹对话气泡,自己不抢焦点:桌宠是门面不是主角
    focusable: false,
    show: false,
    webPreferences: WEB_PREFS
  })
  win.setAlwaysOnTop(true, 'floating')
  // 露窗走主窗同一条经验的简化版(工厂上弦):ready-to-show 快路 + 3 秒看门狗,绝不永久隐身;
  // 露面即把尺寸钉回名义值:透明窗出生就可能被系统喂胖几像素(雷区档案②的出生版)
  armRevealWatchdog(win, { beforeShow: (w) => w.setContentSize(MASCOT_SIZE, MASCOT_SIZE) })
  win.on('closed', () => {
    stopHoverWatch()
    if (mascotWindow === win) mascotWindow = null
  })
  // 桌宠渲染层的 console/报错也进 Developer 日志:小窗藏得深,犯病不能悄无声息
  // (console-message 走事件对象签名,旧的散参形式 Electron 44 已废弃)
  win.webContents.on('console-message', (details) => {
    addDevLog('system', `桌宠页面:${details.message}`)
  })
  loadView(win, VIEWS.mascot)
  // 穿透归轮询管:窗一露面 watch 就上弦 —— 页面加载前后那几秒短暂实心,
  // 点错也只是点到这只小窗,不咬人
  watchHover(win)
  mascotWindow = win
  mascotHidden = false // 重建归位:新窗没藏着
  emitMascotHidden()
  addDevLog('system', '桌宠上岗')
  return win
}

/** 藏起桌宠(假藏):不真 hide() —— focusable:false 的窗在 Windows 上 hide/show 一回,
 * 按下信号(mousedown)就被系统吞掉再也到不了渲染层(mouseup/右键菜单照走,隔离实验实锤);
 * setOpacity(0→1) 的假藏也不行(第六案:合成链断档,一拖就整窗透明)。
 * 改「页面隐身+穿透」假藏:窗还在原地、透明度永远是 1,只是内容不画、鼠标穿透,
 * 等效不存在;hide/show 和 setOpacity 两条断头路以后谁也别再走 */
export function hideMascot(): void {
  const win = mascotWindow
  if (!win || win.isDestroyed()) return
  stopHoverWatch()
  win.setIgnoreMouseEvents(true)
  mascotHidden = true
  win.webContents.send(CH.mascotVisible, false)
  emitMascotHidden()
  addDevLog('system', '桌宠藏起(假藏:页面隐身+整窗穿透,不真 hide 不动透明度)')
}

/** 叫回桌宠:页面画回身体,顺手催一帧(同主面板露窗的工序),轮询上弦 ——
 * 第一拍无条件重设穿透,光标在身上就恢复可点可拖 */
export function showMascot(): void {
  const win = mascotWindow
  if (!win || win.isDestroyed()) return
  mascotHidden = false
  win.webContents.send(CH.mascotVisible, true)
  win.webContents.invalidate()
  watchHover(win)
  emitMascotHidden()
  addDevLog('system', '桌宠叫回')
}

/** 托盘「显示·隐藏桌宠」:照 mascotHidden 旗走(假藏后 isVisible 会说谎);
 * 藏起时轮询下岗,叫回时上弦;窗还没有(小探针没放出)就不吱声 */
export function toggleMascot(): void {
  const win = mascotWindow
  if (!win || win.isDestroyed()) return
  if (!mascotHidden) hideMascot()
  else showMascot()
}

/** 桌宠现在这扇窗(走出面板锤:它改 lazy 上岗,主进程要知道有没有的用) */
export function getMascotWindow(): BrowserWindow | null {
  return mascotWindow && !mascotWindow.isDestroyed() ? mascotWindow : null
}

/** 飞到指定屏幕点落座(走出面板锤):页签拖出主窗松手在哪儿,它就趴哪儿 ——
 * 以松手点为圆心摆好,对着现在的屏幕夹回屏内,位置顺手记档 */
export function seatMascotAt(x: number, y: number): void {
  const win = mascotWindow
  if (!win || win.isDestroyed()) return
  const box = placeMascotBox(
    { x: x - MASCOT_SIZE / 2, y: y - MASCOT_SIZE / 2 },
    screen.getAllDisplays().map((d) => d.workArea)
  )
  if (box.x !== undefined && box.y !== undefined) {
    // setBounds 连尺寸钉死:裸 setPosition 在 150% 缩放下每调一次窗体长 1px(雷区档案②)
    win.setBounds({ x: box.x, y: box.y, width: MASCOT_SIZE, height: MASCOT_SIZE })
    writeMascotState(mascotStateDir, { x: box.x, y: box.y })
  }
}

/** 桌宠自己的通道(send 配 ipcMain.on、invoke 配 handle,收发成对):
 * 拖动三连、点击激活、右键菜单、露面状态拉取。点击唤谁、菜单项干什么、
 * 拖完谁去归位,都由主进程注入;桌宠模块不回头依赖 index.ts */
export function registerMascotIpc(handlers: {
  onActivate: (anchor?: Rectangle) => void
  /** 拖拽落定(松手)那一刻叫一声:气泡按最终落点归位一次 ——
   * 跟随降频(雷区档案):不再每帧都追,一次挪窗攒不出膨胀 */
  onDragEnd?: (anchor: Rectangle) => void
  onDock?: () => void
  onShowMain?: () => void
  /** 主面板现在是不是在屏上(显示且没最小化):菜单第一项照它翻文案 */
  isMainVisible?: () => boolean
  /** 把主面板收回托盘:菜单「隐藏主面板」的动作 */
  onHideMain?: () => void
}): void {
  // 页面挂载时拉一次露面状态:藏起期间页面重载,别让它变「看得见点不着的幽灵」
  ipcMain.handle(CH.mascotVisibleGet, () => !mascotHidden)
  // 拖动三连:按下记抓手(光标到窗左上角的偏移),移动时光标走到哪儿窗跟到哪儿,
  // 松手存档。窗始终贴着光标挪,光标永远相对窗内,mousemove 不会半路丢。
  // 按下那一刻把窗锁成实心(dragging 旗),松手才还给轮询 —— 不然判定拿窗的旧位置
  // 对光标的新位置,穿透一秒开合几十次:窗闪、松手信号漏掉、桌宠跟光标满屏飘。
  let grab = { dx: MASCOT_SIZE / 2, dy: MASCOT_SIZE / 2 }
  ipcMain.on(CH.mascotDragStart, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    dragging = true
    win.setIgnoreMouseEvents(false) // 拖动全程实心,松手信号绝不漏
    const [wx, wy] = win.getPosition()
    const cursor = screen.getCursorScreenPoint()
    grab = { dx: cursor.x - wx, dy: cursor.y - wy }
  })
  ipcMain.on(CH.mascotDragMove, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const tx = cursor.x - grab.dx
    const ty = cursor.y - grab.dy
    // 空挪必须拦住:setPosition 哪怕落到原地,Windows 也会给渲染层发一个
    // 「窗动了」的假信号 → 页面回一句「再挪一下」→ 无限回声(黑匣子实锤:
    // 光标窗体全静止时空挪指令照样每秒几十次空转,手抖被回声放大成漂移)。
    const [cx, cy] = win.getPosition()
    // setBounds 连尺寸钉死:裸 setPosition 在 150% 缩放下每调一次窗体长 1px
    // (雷区档案②:黑匣子拍到拖一趟 140→321,窗往右下长看着就是漂移)
    if (cx !== tx || cy !== ty) win.setBounds({ x: tx, y: ty, width: MASCOT_SIZE, height: MASCOT_SIZE })
  })
  ipcMain.on(CH.mascotDragEnd, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    dragging = false
    // 落定把内容尺寸也钉回名义值:跨缩放档拖一趟,内核画面会按旧档缩放
    // (画面比窗大/小,点影子不灵 —— 透明窗战役·挪窝脱钩案)
    win.setContentSize(MASCOT_SIZE, MASCOT_SIZE)
    // 松手按当前光标位置补一次判定:还在身上保持实心,不在就恢复穿透(不带 forward,见上)
    const inside = mascotCursorInside(win.getBounds(), screen.getCursorScreenPoint())
    win.setIgnoreMouseEvents(!inside)
    lastInside = inside
    const [x, y] = win.getPosition()
    writeMascotState(mascotStateDir, { x, y })
    // 落定叫一声:气泡按最终落点归位一次(跟随降频,雷区档案)
    handlers.onDragEnd?.(win.getBounds())
  })
  // 点击本体 = 激活(带桌宠实时位置,气泡照着它落位)
  ipcMain.on(CH.mascotActivate, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    handlers.onActivate(win && !win.isDestroyed() ? win.getBounds() : undefined)
  })
  // 右键本体 = 快捷菜单:第一项「收回小探针」(走出面板锤的回家路);
  // 主面板在屏上就给「藏起它」,不在就给「叫它出来」;再把自己藏起来、真退出
  ipcMain.on(CH.mascotMenu, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const mainVisible = handlers.isMainVisible?.() ?? false
    Menu.buildFromTemplate([
      { label: '把小探针收回主面板', click: () => handlers.onDock?.() },
      {
        label: mainPanelMenuLabel(mainVisible),
        click: () => (mainVisible ? handlers.onHideMain?.() : handlers.onShowMain?.())
      },
      { label: '隐藏桌宠(托盘可找回)', click: () => hideMascot() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]).popup({ window: win })
  })
}
