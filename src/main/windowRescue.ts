// 主窗的「救生圈」全套:露窗后的三路救援 —— 渲染层崩了重挂、GPU 打嗝重开画布、
// 画面心跳停了整页重挂;外加 Ctrl+Alt+0 手动拉起(按两下 = 整页重挂)。
// 病根档案:透明无边框窗在透明合成管线上会「进程全活着、画面却再也出不来」,
// 唯一有效的解药是整页 reload。这里把这套看门狗收成一处,主窗只管建窗。
import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { addDevLog } from '../shared/devlog.ts'
import { CH } from '../shared/ipcChannels.ts'
import { refreshModelStatus } from './modelStatus.ts'

/** 手动拉起的保命窗口:10 秒内连按第二下 = 整页重挂(3 秒来不及,小葵连按三下全超时过) */
const HOTKEY_ARM_MS = 10_000

/** 画面心跳的耐心:渲染层每秒报一跳,露着窗却 10 秒没跳 = 画面管线停摆 */
const FRAME_BEAT_PATIENCE_MS = 10_000

/** 给主窗上弦:崩溃重接 / GPU 重开画布 / 心跳看门狗 / 手动拉起。窗关掉时自己收摊 */
export function installWindowRescue(mainWindow: BrowserWindow): void {
  // 「接回横幅」:救生圈动过手(reload 完/GPU 重启完)就捎个信,让页面弹一句人话
  let revivePending = false
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.invalidate()
    // 顺手把模型状态问一轮:状态栏一开屏就有真话可说,不必空等轮询
    void refreshModelStatus().catch(() => {})
    if (revivePending) {
      revivePending = false
      mainWindow.webContents.send(CH.rendererRevived)
    }
  })
  // 救生圈(2026-09-13 小葵两次报案:「界面凭空消失,后台还开着」)。这窗是透明无边框的,
  // 渲染层一崩或 GPU 进程一打嗝重启,窗口就整窗透明 —— 看着像消失,其实进程全活着。
  // 渲染层真崩:记进后台状态表(状态表住主进程,渲染层死了也活着),reload 把页面重挂回来。
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
  // 卡死不拉黑:渲染层主线程僵住超过 10 秒记一笔,让后台状态表有话可查(不动手,等它自己醒)
  mainWindow.webContents.on('unresponsive', () => {
    console.log('[window] 渲染层没响应了一阵')
    addDevLog('system', '画面卡住了一阵(渲染层没响应) —— 记一笔备查')
  })
  // ── 救生圈 2.0(第五案实测定性后立):隐身的真身是「渲染进程活着,画面管线却永久
  // 停摆」——实测这种状态下重画/藏亮/改尺寸全都叫不醒,唯一有效的解药是整页重挂
  // (重载后画面 100% 复活)。所以不再空等它自己醒:渲染层用 rAF 每秒报一跳
  // 「画面循环还在转」;窗明明露着、心跳却停了 10 秒以上,主进程直接 reload 重挂管线,
  // 自动满血,不用小葵按任何键。心跳同时是常驻取证:rAF 停没停,后台状态表里看得见。
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
    if (gap <= FRAME_BEAT_PATIENCE_MS) return
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
    clearInterval(frameBeatWatchdog)
    ipcMain.removeListener(CH.frameHeartbeat, onFrameBeat)
    if (hotkeyArmTimer) clearTimeout(hotkeyArmTimer)
    globalShortcut.unregister('CommandOrControl+Alt+0')
    app.removeListener('child-process-gone', onGpuGone)
  })
}
