// ── 撕窗子窗桥(页签撕窗锤)──
// 子窗 = 主窗渲染层 window.open 开出来的同进程子窗(about:blank 白窗),
// 页签的活的 DOM 由 React Portal 渲染进它的 document —— 户口在渲染层,
// 主进程只管两件小事:
//   1) 放行白名单:只有 aux- 前缀 frameName 的 window.open 才许成窗,而且无边框;
//   2) 窗口操作代发:子窗没有 preload 没有 window.atlas,缩放/关闭由主窗渲染层
//      经 atlas:aux-window-op 代发,这边按 frameName 从注册表找窗执行。
import { ipcMain, screen, shell, BrowserWindow } from 'electron'
import { CH } from '../shared/ipcChannels.ts'
import type { AuxWindowOp } from '../shared/types.ts'
import { addDevLog } from '../shared/devlog.ts'
import { trackWindowBackground, windowCanvasColor } from './windowTheme.ts'

/** frameName 白名单前缀:渲染层 useAuxWindows 发号(aux-1/aux-2/...),主进程只认它 */
const AUX_PREFIX = 'aux-'

/** frameName → BrowserWindow 注册表:did-create-window 记进来,closed 清账 */
const auxRegistry = new Map<string, BrowserWindow>()

function isAuxFrame(frameName: string | undefined): frameName is string {
  return typeof frameName === 'string' && frameName.startsWith(AUX_PREFIX)
}

/** frameName → 子窗本体(注册表取窗的唯一门口):拖窗 IPC 按它认目标窗 */
export function auxWindowByName(frameName: string): BrowserWindow | null {
  const win = auxRegistry.get(frameName)
  return win && !win.isDestroyed() ? win : null
}

/** 新子窗的落点:在松手的光标附近落座,别每次都堆在 (0,0) —— 整窗夹回工作区 */
function auxBoundsFor(cursor: Electron.Point): Electron.Rectangle {
  const w = 720
  const h = 480
  const wa = screen.getDisplayNearestPoint(cursor).workArea
  return {
    x: Math.min(Math.max(Math.round(cursor.x - w / 3), wa.x), wa.x + wa.width - w),
    y: Math.min(Math.max(Math.round(cursor.y - 24), wa.y), wa.y + wa.height - h),
    width: w,
    height: h
  }
}

/**
 * 给主窗装上子窗桥(createWindow 里建完主窗后调一次):
 * window.open 总闸 + 无边框定形 + did-create-window 注册表。
 * 注意:setWindowOpenHandler 每个 webContents 只有一席 —— 「外部链接转系统浏览器」
 * 那条老规矩也并进这一道闸,别处再装 handler 会把它整个顶掉。
 */
export function installAuxWindowBridge(mainWindow: BrowserWindow): void {
  const wc = mainWindow.webContents
  wc.setWindowOpenHandler(({ frameName, url }) => {
    if (isAuxFrame(frameName)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...auxBoundsFor(screen.getCursorScreenPoint()),
          minWidth: 360,
          minHeight: 260,
          frame: false,
          autoHideMenuBar: true,
          title: 'CodeAtlas',
          // 实底壳(全窗实底化):底色钉画布同色,建窗一刻不闪异色
          backgroundColor: windowCanvasColor(),
          show: true
          // webPreferences 不给:about:blank 白窗只当画布,preload/Node 一概不要
        }
      }
    }
    // 外部链接交给系统浏览器打开,不在应用里开新窗口;只放行 http(s)/mailto ——
    // file:// 这类进系统 handler 等于替页面拉起本地程序,畸形串直接当没听见
    try {
      const { protocol } = new URL(url)
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
        void shell.openExternal(url)
      }
    } catch {
      /* 畸形地址:拒开 */
    }
    return { action: 'deny' }
  })
  wc.on('did-create-window', (child, details) => {
    if (!isAuxFrame(details.frameName)) return
    const name = details.frameName
    auxRegistry.set(name, child)
    trackWindowBackground(child)
    child.on('closed', () => {
      if (auxRegistry.get(name) === child) auxRegistry.delete(name)
    })
    addDevLog('system', `撕窗子窗「${name}」上岗`)
  })
}

/**
 * 子窗窗口操作通道:主窗渲染层代发(Portal 组件跑在主 realm,window.atlas 在手)。
 * 安全:只认主窗 webContents 发来的;frameName 必须在注册表里 —— 别家窗不许代管。
 */
export function registerAuxWindowIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.on(CH.auxWindowOp, (event, payload: unknown) => {
    const main = getMainWindow()
    if (!main || main.isDestroyed() || event.sender !== main.webContents) return
    const p = payload as { frameName?: unknown; op?: unknown } | null
    if (!p || !isAuxFrame(p.frameName as string | undefined)) return
    const win = auxRegistry.get(p.frameName as string)
    if (!win || win.isDestroyed()) return
    switch (p.op as AuxWindowOp) {
      case 'minimize':
        win.minimize()
        break
      case 'toggleMaximize':
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
        break
      case 'close':
        win.close()
        break
      case 'focus':
        win.focus()
        break
      default:
        break
    }
  })
}

// 退场不用专账:子窗跟主窗同进程,主窗一关它们天然陪葬;注册表随进程销毁不欠谁。
