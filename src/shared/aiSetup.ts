import type { AiConfig, AiProviderKind } from './types.ts'

/** AI 来源的展示名:设置页下拉用全称,状态浮层用短称 */
export const PROVIDER_OPTIONS: readonly { id: AiProviderKind; label: string }[] = [
  { id: 'builtin', label: '内置模型' },
  { id: 'lmstudio', label: 'LM Studio' },
  { id: 'cloud', label: '在线 API' }
]
export const PROVIDER_SHORT_LABEL: Record<AiProviderKind, string> = {
  builtin: '内置',
  lmstudio: 'LM Studio',
  cloud: '在线 API'
}

export function isAiConfigured(config: AiConfig): boolean {
  if (config.provider === 'builtin') return config.builtin.modelPath.trim() !== ''
  if (config.provider === 'cloud') {
    const { cloud } = config
    return (
      cloud.consented &&
      cloud.apiKey.trim() !== '' &&
      cloud.model.trim() !== '' &&
      isHttpUrl(cloud.baseUrl)
    )
  }
  return config.lmstudio.model.trim() !== '' && isHttpUrl(config.lmstudio.baseUrl)
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
