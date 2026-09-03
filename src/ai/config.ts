// AI 配置的本地持久化:存到 userData 下的 ai-config.json,界面改了下次还能用。
// 路径契约:这是 Electron 自己的配置文件,不涉及项目内文件,不经过 joinRoot。
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AiConfig } from '../shared/types.ts'

/** 默认指向 LM Studio 本地服务;模型名留空 = 还没配置,由界面引导填 */
export function defaultAiConfig(): AiConfig {
  return { baseUrl: 'http://127.0.0.1:1234/v1', model: '', apiKey: '' }
}

export function aiConfigPath(userDataDir: string): string {
  // 用下划线前缀:这不是项目文件,避免和扫描出的节点混淆
  return join(userDataDir, 'ai-config.json')
}

export async function loadAiConfig(userDataDir: string): Promise<AiConfig> {
  const fallback = defaultAiConfig()
  try {
    const raw = await fs.readFile(aiConfigPath(userDataDir), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AiConfig>
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() ? parsed.baseUrl : fallback.baseUrl,
      model: typeof parsed.model === 'string' ? parsed.model : fallback.model,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : ''
    }
  } catch {
    return fallback
  }
}

export async function saveAiConfig(userDataDir: string, config: AiConfig): Promise<AiConfig> {
  const normalized: AiConfig = {
    baseUrl: config.baseUrl.trim(),
    model: config.model.trim(),
    apiKey: config.apiKey?.trim() ?? ''
  }
  await fs.writeFile(aiConfigPath(userDataDir), JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}
