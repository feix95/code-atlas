// ── 开窗工厂(DRY 收口)──
// 四扇窗(主窗/日志窗/桌宠/气泡)同吃一副壳药:安全 webPreferences、透明无边框底、
// 露窗多路抢跑 + 3 秒看门狗、?view= 加载。以前每扇窗各抄一遍,安全开关改一处漏三处。
// 这里只出「共有的底」;各窗自己的戏份(尺寸/落位/事件接线/救生圈)还在原文件。

import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'

/** 视图名户口:?view= 参数和渲染入口(main.tsx)的分诊表对账 —— 主窗不带参,默认页就是它 */
export const VIEWS = {
  devlogs: 'devlogs',
  mascot: 'mascot',
  bubble: 'bubble'
} as const
export type ViewName = (typeof VIEWS)[keyof typeof VIEWS]

/** 安全开关四窗一副:沙盒不开(preload 桥要够得着 Node)、隔离必开、node 不许进页面、
 *  后台节流关掉 —— 首帧探测和桌宠呼吸这类小动画全靠渲染层 rAF,憋着就憋死 */
export const WEB_PREFS: Electron.WebPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: false,
  contextIsolation: true,
  nodeIntegration: false,
  backgroundThrottling: false
}

/** 露窗链的定制口:每扇窗在抢跑信号和看门狗兜底之外的小动作 */
export interface RevealWatchdog {
  /** 露面那刻在 win.show() 之前跑(钉回名义尺寸/记账之类) */
  beforeShow?: (win: BrowserWindow, via: string) => void
  /** 露面那刻在 win.show() 之后跑(聚焦之类) */
  afterShow?: (win: BrowserWindow, via: string) => void
  /** 渲染层双 rAF 首帧快路:'exclusive' 独占通道(主窗:先把旧监听全清再按 sender 认);
   *  'shared' 各挂各的(日志窗);缺省 = 不陪跑(小窗页面轻,两路就够) */
  firstFrame?: 'exclusive' | 'shared'
  /** 看门狗毫秒数,默认 3000 —— 唯一无条件的兜底,宁可早闪一下,不可隐身躲猫猫 */
  timeoutMs?: number
}

/**
 * 露窗三保险上弦:ready-to-show 快路 +(可选)渲染层双 rAF 首帧信号 + 无条件看门狗,
 * 多路抢跑,谁都不许当唯一依靠 —— 无边框模式下 ready-to-show 在部分高缩放屏上
 * 永不触发(第三十六锤补实测),不能指望它;窗口绝不永久隐身。
 * via 报给定制口的三档:'ready-to-show' / 'first-frame' / 'watchdog-Ns'。
 */
export function armRevealWatchdog(win: BrowserWindow, opts: RevealWatchdog = {}): void {
  const timeoutMs = opts.timeoutMs ?? 3000
  let shown = false
  const showOnce = (via: string): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    opts.beforeShow?.(win, via)
    win.show()
    opts.afterShow?.(win, via)
  }
  // 1) 常见快路:GPU 栈干净时它先到
  win.once('ready-to-show', () => showOnce('ready-to-show'))
  // 2) 渲染层双 rAF 信号:按 sender 认窗,别家小窗的帧不许替这扇报平安
  if (opts.firstFrame) {
    const onFirstFrame = (event: Electron.IpcMainEvent): void => {
      if (event.sender !== win.webContents) return
      showOnce('first-frame')
      ipcMain.removeListener('atlas:first-frame', onFirstFrame)
    }
    if (opts.firstFrame === 'exclusive') ipcMain.removeAllListeners('atlas:first-frame')
    ipcMain.on('atlas:first-frame', onFirstFrame)
    win.on('closed', () => ipcMain.removeListener('atlas:first-frame', onFirstFrame))
  }
  // 3) 看门狗:唯一无条件的兜底。隐藏的透明窗此刻多半还没内容,
  //    用户看到「窗口浮现」的实际时刻仍是首帧画好之时
  setTimeout(() => showOnce(`watchdog-${Math.round(timeoutMs / 1000)}s`), timeoutMs)
}

/** 开发模式加载 Vite 开发服务器,打包后加载本地文件;?view= 分诊认 VIEWS 户口(不传 = 主窗) */
export function loadView(win: BrowserWindow, view?: ViewName): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    if (view === undefined) {
      void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
      return
    }
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('view', view)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), view === undefined ? undefined : { query: { view } })
  }
}
