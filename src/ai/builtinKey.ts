// 内置引擎的对账键:程序路径|模型|引擎后端|高级启动账签名 —— 任何一项变了,重启才算数。
import type { AiBuiltinSettings } from '../shared/types.ts'
import { launchFor, launchSignature } from '../shared/launchSettings.ts'

export function settingsKey(settings: AiBuiltinSettings): string {
  // 高级启动账 + 引擎后端选择都进对账键:改了任何一项 = 设置变了,要重启才作数
  return `${settings.serverPath.trim()}|${settings.modelPath.trim()}|${settings.backend ?? 'auto'}|${launchSignature(launchFor(settings))}`
}
