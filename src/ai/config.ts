// AI 配置的本地持久化:存到 userData 下的 ai-config.json,界面改了下次还能用。
// 路径契约:这是 Electron 自己的配置文件,不涉及项目内文件,不经过 joinRoot。
// 双 Provider:provider 选当前用谁;两个分支的设置都常驻,切换不丢配置。
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AiConfig, ChatTarget } from '../shared/types.ts'

/** 默认指向 LM Studio 本地服务;模型名留空 = 还没配置,由界面引导填 */
export function defaultAiConfig(): AiConfig {
  return {
    provider: 'lmstudio',
    lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1', model: '', apiKey: '' },
    builtin: { serverPath: '', modelPath: '' }
  }
}

export function aiConfigPath(userDataDir: string): string {
  // 用下划线前缀:这不是项目文件,避免和扫描出的节点混淆
  return join(userDataDir, 'ai-config.json')
}

/** 字符串字段兜底:非字符串或空串时用默认值 */
function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

export async function loadAiConfig(userDataDir: string): Promise<AiConfig> {
  const fallback = defaultAiConfig()
  try {
    const raw = await fs.readFile(aiConfigPath(userDataDir), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>

    // 老版本配置是扁平的 {baseUrl, model, apiKey}:自动搬进 lmstudio 分支,用户无感
    if (typeof parsed.baseUrl === 'string' && !parsed.provider) {
      parsed.lmstudio = { baseUrl: parsed.baseUrl, model: parsed.model ?? '', apiKey: parsed.apiKey ?? '' }
    }

    const lm = (parsed.lmstudio ?? {}) as Record<string, unknown>
    const bi = (parsed.builtin ?? {}) as Record<string, unknown>
    return {
      provider: parsed.provider === 'builtin' ? 'builtin' : 'lmstudio',
      lmstudio: {
        baseUrl: str(lm.baseUrl, fallback.lmstudio.baseUrl),
        model: typeof lm.model === 'string' ? lm.model : '',
        apiKey: typeof lm.apiKey === 'string' ? lm.apiKey : ''
      },
      builtin: {
        serverPath: typeof bi.serverPath === 'string' ? bi.serverPath : '',
        modelPath: typeof bi.modelPath === 'string' ? bi.modelPath : ''
      }
    }
  } catch {
    return fallback
  }
}

export async function saveAiConfig(userDataDir: string, config: AiConfig): Promise<AiConfig> {
  const normalized: AiConfig = {
    provider: config.provider === 'builtin' ? 'builtin' : 'lmstudio',
    lmstudio: {
      baseUrl: config.lmstudio.baseUrl.trim(),
      model: config.lmstudio.model.trim(),
      apiKey: config.lmstudio.apiKey.trim()
    },
    builtin: {
      serverPath: config.builtin.serverPath.trim(),
      modelPath: config.builtin.modelPath.trim()
    }
  }
  await fs.writeFile(aiConfigPath(userDataDir), JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

/** 内置模型子进程就绪后上报的运行时目标(baseUrl + 模型名) */
export interface BuiltinRuntime {
  baseUrl: string
  model: string
}

/**
 * 把当前设置收敛成一次对话的 ChatTarget —— 上层业务只认它,不感知 Provider 是谁。
 * 纯函数:不碰子进程,缺什么用 Message 说清楚,让调用方原样转给界面。
 */
export function resolveAiTarget(
  config: AiConfig,
  builtinRuntime?: BuiltinRuntime
): { ok: true; target: ChatTarget } | { ok: false; message: string } {
  if (config.provider === 'builtin') {
    if (!builtinRuntime) {
      return {
        ok: false,
        message: config.builtin.modelPath.trim()
          ? '内置模型正在启动,稍等几秒再试'
          : '还没选模型:去「AI 设置」点「选择模型」,选一个 GGUF 模型文件'
      }
    }
    return { ok: true, target: { baseUrl: builtinRuntime.baseUrl, model: builtinRuntime.model } }
  }
  if (!config.lmstudio.model.trim()) {
    return { ok: false, message: '还没选模型:去「AI 设置」连一下 LM Studio' }
  }
  return {
    ok: true,
    target: { baseUrl: config.lmstudio.baseUrl, model: config.lmstudio.model, apiKey: config.lmstudio.apiKey || undefined }
  }
}
