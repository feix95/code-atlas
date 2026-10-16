// 引擎后端管理 IPC(第 4 期):状态报单、一键安装(进度推送)、取消、卸载。
// 只调度 engineLocator/engineInstaller;不碰启动逻辑(那在 builtin.ts)。
import { BrowserWindow, ipcMain } from 'electron'
import { CH } from '../shared/ipcChannels.ts'
import {
  sanitizeBackendChoice,
  type EngineBackend,
  type EngineStateInfo
} from '../shared/engineCatalog.ts'
import {
  cleanupStaleTmp,
  installBackend,
  installingNow,
  listInstalled,
  removeBackend
} from '../ai/engineInstaller.ts'
import { engineVersionFor, locateEngine } from '../ai/engineLocator.ts'
import { recommendBackend } from '../shared/enginePick.ts'
import { queryMachineProfile } from '../ai/machineProbe.ts'
import { loadAiConfig } from '../ai/config.ts'
import { userDataDir } from './paths.ts'

async function engineState(): Promise<EngineStateInfo> {
  const dir = userDataDir()
  const config = await loadAiConfig(dir)
  const userChoice = sanitizeBackendChoice(config.builtin.backend)
  const installed = listInstalled(dir)
  const machine = await queryMachineProfile()
  const rec = recommendBackend(machine)
  const engine = await locateEngine(config.builtin, dir)
  const version = engine.exePath ? await engineVersionFor(engine.exePath) : null
  return {
    recommended: rec,
    installed,
    active: {
      kind: engine.kind,
      backend: engine.backend,
      label: engine.label,
      version
    },
    wantInstall: engine.wantInstall,
    userChoice,
    installing: installingNow()
  }
}

/** 每个后端一个取消闸:renderer 取消时按后端找闸拉线 */
const cancelHandles = new Map<EngineBackend, AbortController>()

export function registerEngineIpc(): void {
  // 开机扫一次安装残局(上次装到一半留下的 .tmp)
  cleanupStaleTmp(userDataDir())

  ipcMain.handle(CH.engineState, () => engineState().catch(() => null))

  ipcMain.handle(CH.engineInstall, async (event, backend: unknown) => {
    const b = sanitizeBackendChoice(backend)
    if (b === 'auto') return { ok: false, error: '没认出要装哪颗引擎' }
    const dir = userDataDir()
    const win = BrowserWindow.fromWebContents(event.sender)
    const controller = new AbortController()
    cancelHandles.set(b, controller)
    try {
      await installBackend(b, {
        userDataDir: dir,
        signal: controller.signal,
        onProgress: (p) => {
          if (win && !win.isDestroyed()) win.webContents.send(CH.engineInstallProgress, p)
        }
      })
      return { ok: true as const }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '安装失败,请重试'
      return { ok: false as const, error: msg }
    } finally {
      cancelHandles.delete(b)
    }
  })

  ipcMain.handle(CH.engineInstallCancel, (_event, backend: unknown) => {
    const b = sanitizeBackendChoice(backend)
    if (b !== 'auto') cancelHandles.get(b)?.abort()
    return { ok: true }
  })

  ipcMain.handle(CH.engineRemove, async (_event, backend: unknown) => {
    const b = sanitizeBackendChoice(backend)
    if (b === 'auto') return { ok: false, error: '没认出要卸哪颗引擎' }
    try {
      await removeBackend(userDataDir(), b)
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : '卸载失败' }
    }
  })
}
