import { registerShellIpc } from './ipcShell.ts'
import { registerScanIpc } from './ipcScan.ts'
import { registerModelIpc } from './ipcModel.ts'
import { registerChatIpc } from './ipcChat.ts'
import { registerEditIpc } from './ipcEdit.ts'
import { registerLaunchPlanIpc } from './ipcLaunchPlan.ts'
import { registerEngineIpc } from './ipcEngine.ts'
import { registerTranslateIpc } from './ipcTranslate.ts'

export function registerIpc(): void {
  registerShellIpc()
  registerScanIpc()
  registerModelIpc()
  registerChatIpc()
  registerEditIpc()
  registerLaunchPlanIpc()
  registerEngineIpc()
  registerTranslateIpc()
}
