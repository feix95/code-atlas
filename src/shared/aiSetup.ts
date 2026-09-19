import type { AiConfig } from './types.ts'
export function isAiConfigured(config: AiConfig): boolean {
  if (config.provider === 'builtin') return config.builtin.modelPath.trim() !== ''
  if (!config.lmstudio.model.trim()) return false
  try {
    const url = new URL(config.lmstudio.baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
