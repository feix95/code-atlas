import { userDataDir } from './paths.ts'
import { broadcastModelStatus } from './modelStatus.ts'
import {
  createTray,
  createWindow,
  detachFreechat,
  disposeTray,
  dockFreechat,
  mainPanelController,
  mainWindowRef,
  setQuitting,
  showMainWindow
} from './appShell.ts'
import { registerIpc } from './registerIpc.ts'
import { app, globalShortcut, ipcMain, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { registerMascotIpc } from './mascot.ts'
import { followBubble, registerBubbleIpc, toggleBubble } from './bubble.ts'
import {
  queryMachineSpec,
  reapOrphanServer,
  setBuiltinStatusAnnouncer,
  setBuiltinWarmupDir,
  stopBuiltinServer
} from '../ai/builtin.ts'
import { addDevLog, setDevLogListener } from '../shared/devlog.ts'
import { CH } from '../shared/ipcChannels.ts'

/** 清掉 7 天前的崩溃转储(.dmp):单份好几 MB,崩几次就攒一坨,应用不该自己攒垃圾 */
async function cleanupOldCrashDumps(userDataDir: string): Promise<void> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const dirs = [join(userDataDir, 'Crashpad', 'reports'), join(userDataDir, 'Crashpad', 'pending')]
  for (const dir of dirs) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue // 目录不存在 = 没崩过,好事
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.dmp')) continue
      const fullPath = join(dir, entry.name)
      const stat = await fs.stat(fullPath).catch(() => null)
      if (stat && stat.mtimeMs < cutoff) {
        await fs.rm(fullPath, { force: true }).catch(() => {})
      }
    }
  }
}

// 根治「画面凭空消失」(2026-09-13 小葵三次报案,第三次坐实:进程和页面全活着,
// 没有任何事件可抓,聊多了必犯)—— 这台 Win10 的透明无边框窗,显卡合成链一打嗝就整窗
// 透明蒸发,而且悄无声息,救生圈的监听根本收不到通知。那就釜底抽薪:不让 GPU 参与合成,
// 软件渲染(Skia)的每一帧都不经过显卡驱动,透明窗从此跟驱动打嗝绝缘。
// 咱家是文本/列表界面,没有视频大图要喂,软件合成的代价付得起。必须在 app 就绪前调用。
app.disableHardwareAcceleration()
// 第四案(软件渲染版照样隐身)补刀:凶手不在显卡,在 Windows 合成器那一层。
// 两道开关都冲着「无声断供」去:
// ① Chromium 的原生窗口遮挡计算在 Windows 上有老毛病,会把没被遮住的窗误判成
//    「被遮住了」从而停画 —— 这是社区公认的窗口凭空消失惯犯,直接关掉这个 feature;
// ② 见 createWindow 里的 5 秒一次强制重画(让 DWM 随时都能接上新帧)。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
// 退出时把全局快捷键一并还回去,不留幽灵热键占着系统;托盘图标一并摘掉,不留僵尸托盘
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  disposeTray()
})

function startApp(): void {
  createWindow()
  registerIpc()
  createTray()
  // 桌宠通道(走出面板锤):窗改 lazy —— 对话住进桌宠时 ensureMascot 现建,
  // 平时桌面干干净净;点它 = 对话气泡开/关;拖拽落定那刻气泡按落点归位一次
  // (跟随降频:不每帧都追,透明窗高频挪窗是雷区,一次挪窗攒不出膨胀)
  registerMascotIpc({
    onActivate: (anchor) => toggleBubble(anchor),
    onDragEnd: (anchor) => followBubble(anchor),
    onDock: () => dockFreechat(),
    onShowMain: () => showMainWindow(),
    // 主面板的显示/隐藏/最小化/恢复都由控制器记账:在不在屏上问它,收回托盘也让它动手
    isMainVisible: () => mainPanelController?.isShown() ?? false,
    onHideMain: () => mainPanelController?.hide()
  })
  // 页签拖出主窗 / 页签右键「放到桌面」= 放出小探针(只认主窗渲染层发来的;
  // force=true 是右键菜单点的,跳过窗外判定,桌宠落记忆位)
  ipcMain.on(CH.freechatDetach, (event, force: unknown) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindowRef) return
    detachFreechat(force === true)
  })
  // 气泡通道(桌宠气泡):共享对话要够得着主窗;
  // 「回主面板」走 dock 收回链路(气泡+主窗占位卡同路)
  registerBubbleIpc({
    getMainWindow: () => mainWindowRef,
    dock: () => dockFreechat(),
    stateDir: userDataDir()
  })

  // 后台日志广播员上岗(第八十七锤):每记一笔就推给所有窗口(日志窗口常驻收听)
  setDevLogListener((entry) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(CH.devLog, entry)
    }
  })
  addDevLog('system', 'CodeAtlas 启动')

  // 内置引擎的状态播报员上岗:引擎一动(热身/进度/就绪/出岔子/被卸下)就广播给状态栏
  setBuiltinStatusAnnouncer(broadcastModelStatus)
  // 热身耗时小账本安家 userData:模型上次热身多久,下次估价进度就有据可依
  setBuiltinWarmupDir(userDataDir())
  // 机器家底提前问一遍(显存走 nvidia-smi):引擎万一启动就死,验尸话张口就来,不现场等
  void queryMachineSpec().catch(() => {})

  // 开场两件家务:上次异常退出留下的内置模型孤儿就地收尸(不占内存不堵端口);
  // 旧的崩溃转储过期的清掉。都是后台安静干,失败也不打扰启动
  void reapOrphanServer().catch(() => {})
  void cleanupOldCrashDumps(userDataDir()).catch(() => {})

  // macOS:点 Dock 图标时,没有窗口就重新建一个
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

// ── 单实例锁(桌宠托管第一锤;当年双实例 GPU 缓存大战的老伤疤,别再揭一次)──
// 抢不到锁 = 已经有一个 CodeAtlas 在跑:本实例一个窗都不建,悄悄退场。
// 已在跑的实例通过 second-instance 收到敲门:把主窗带焦点唤回前台。
app.on('before-quit', () => {
  setQuitting(true)
})

app.on('second-instance', () => {
  showMainWindow()
})
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.whenReady().then(startApp)
}

app.on('will-quit', () => {
  stopBuiltinServer() // 内置模型是子进程,退出时带走,不留孤儿进程占着显存
})

app.on('window-all-closed', () => {
  // Windows / Linux:所有窗口都没了才退出。收起模式(桌宠托管第一锤)下关窗只是
  // 藏进托盘、窗口不销毁,这个事件不触发 —— 真退出走托盘「退出」,走到这儿时
  // quit 已在进行,再喊一声无害
  if (process.platform !== 'darwin') app.quit()
})
