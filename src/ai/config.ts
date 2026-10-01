// AI 配置的本地持久化:存到 userData 下的 ai-config.json,界面改了下次还能用。
// 路径契约:这是 Electron 自己的配置文件,不涉及项目内文件,不经过 joinRoot。
// 三 Provider:provider 选当前用谁;各分支的设置都常驻,切换不丢配置。
// 在线 API 的 Key 落盘前经 secretCodec 加密(主进程注入 safeStorage),内存与 IPC 里是明文。
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AiCloudSettings, AiConfig, AiProviderKind, ChatTarget } from '../shared/types.ts'
import { CONTEXT_SIZE_MIN, DEFAULT_LMSTUDIO_BASE_URL } from '../shared/aiDefaults.ts'
import {
  CLOUD_DEFAULT_CONTEXT,
  DEFAULT_CLOUD_VENDOR,
  findCloudVendor,
  sanitizeCloudContext,
  sanitizeCloudVendorId
} from '../shared/cloudVendors.ts'
import { DEFAULT_PERSONALIZATION, sanitizePersonalization } from '../shared/personalization.ts'
import { sanitizeTavilyKey } from '../shared/tavily.ts'
import { openSecret, sealSecret } from './secretCodec.ts'

/** Provider 字段兜底:认不出的(含老配置缺字段)一律按 lmstudio,与历史行为一致 */
export function sanitizeProviderKind(value: unknown): AiProviderKind {
  return value === 'builtin' || value === 'cloud' ? value : 'lmstudio'
}

function defaultCloudSettings(): AiCloudSettings {
  return {
    vendor: DEFAULT_CLOUD_VENDOR,
    baseUrl: findCloudVendor(DEFAULT_CLOUD_VENDOR)?.baseUrl ?? '',
    model: '',
    apiKey: '',
    contextSize: CLOUD_DEFAULT_CONTEXT,
    consented: false
  }
}

/** 在线 API 分支的清洗(读档与存档共用);apiKey 由调用方给出明文 */
function normalizeCloud(raw: Record<string, unknown>, apiKey: string): AiCloudSettings {
  const vendor = sanitizeCloudVendorId(raw.vendor)
  return {
    vendor,
    baseUrl: str(raw.baseUrl, findCloudVendor(vendor)?.baseUrl ?? '').trim(),
    model: typeof raw.model === 'string' ? raw.model.trim() : '',
    apiKey: apiKey.trim(),
    contextSize: sanitizeCloudContext(raw.contextSize),
    consented: raw.consented === true
  }
}

/** 默认走内置引擎(2026-09-18 小葵定:新用户开箱即内置,配货架顶部「推荐模型」一键下载
 *  正好凑成第一步);模型路径留空 = 还没下模型,界面引导去货架。联网查证默认关,说话方式是全默认 */
export function defaultAiConfig(): AiConfig {
  return {
    provider: 'builtin',
    lmstudio: { baseUrl: DEFAULT_LMSTUDIO_BASE_URL, model: '', apiKey: '' },
    builtin: { serverPath: '', modelPath: '' },
    cloud: defaultCloudSettings(),
    webLookup: false,
    personalization: { ...DEFAULT_PERSONALIZATION }
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
      parsed.lmstudio = {
        baseUrl: parsed.baseUrl,
        model: parsed.model ?? '',
        apiKey: parsed.apiKey ?? ''
      }
    }

    const lm = (parsed.lmstudio ?? {}) as Record<string, unknown>
    const bi = (parsed.builtin ?? {}) as Record<string, unknown>
    const cl = (parsed.cloud ?? {}) as Record<string, unknown>
    return {
      provider: sanitizeProviderKind(parsed.provider),
      lmstudio: {
        baseUrl: str(lm.baseUrl, fallback.lmstudio.baseUrl),
        model: typeof lm.model === 'string' ? lm.model : '',
        apiKey: typeof lm.apiKey === 'string' ? lm.apiKey : ''
      },
      builtin: {
        serverPath: typeof bi.serverPath === 'string' ? bi.serverPath : '',
        modelPath: typeof bi.modelPath === 'string' ? bi.modelPath : ''
      },
      // 老配置没有 cloud 分支 = 全默认(未确认、未填 Key);密文解不开(换机器)= Key 为空,请用户重填
      cloud: normalizeCloud(cl, openSecret(cl)),
      // 老配置没这个字段 = 默认关,行为与从前完全一致
      webLookup: parsed.webLookup === true,
      // Tavily Key(可选):老配置没这字段 = undefined,走免费链,行为与从前完全一致。
      // 读档也洗一遍(2026-09-17):老档里可能躺着带引号/带 Bearer 前缀的脏值,读出来就是干净的
      tavilyKey: sanitizeTavilyKey(parsed.tavilyKey),
      // 手动上下文(留空 = 自动探测);上一版存取两边都把它弄丢了,这里补上回读
      contextSize:
        typeof parsed.contextSize === 'number' && parsed.contextSize >= CONTEXT_SIZE_MIN
          ? parsed.contextSize
          : undefined,
      // 说话方式(第一百一十三锤):老配置没这字段 = 全默认,拼出来是空串,提示词逐字不变
      personalization: sanitizePersonalization(parsed.personalization)
    }
  } catch {
    return fallback
  }
}

export async function saveAiConfig(userDataDir: string, config: AiConfig): Promise<AiConfig> {
  const cloudRaw = (config.cloud ?? {}) as unknown as Record<string, unknown>
  const normalized: AiConfig = {
    provider: sanitizeProviderKind(config.provider),
    lmstudio: {
      baseUrl: config.lmstudio.baseUrl.trim(),
      model: config.lmstudio.model.trim(),
      apiKey: config.lmstudio.apiKey.trim()
    },
    builtin: {
      serverPath: config.builtin.serverPath.trim(),
      modelPath: config.builtin.modelPath.trim()
    },
    cloud: normalizeCloud(cloudRaw, typeof cloudRaw.apiKey === 'string' ? cloudRaw.apiKey : ''),
    webLookup: config.webLookup === true,
    // Tavily Key 洗一遍再落盘:剥掉引号/Bearer 前缀/中间空白,洗完是空当没填(存档里直接不出现这个字段)
    tavilyKey: sanitizeTavilyKey(config.tavilyKey),
    // JSON.stringify 会直接丢掉 undefined:没填上下文时落盘就是没有这个字段,读取走自动探测
    contextSize:
      typeof config.contextSize === 'number' && config.contextSize >= CONTEXT_SIZE_MIN
        ? config.contextSize
        : undefined,
    // 说话方式照洗一遍再落盘:脏数据不许进存档(键顺序和读档那边保持一致,免得假「有改动」)
    personalization: sanitizePersonalization(config.personalization)
  }
  // 落盘版只换掉在线 API 的 Key(明文 → 密文);返回给调用方的仍是明文版
  const { apiKey: cloudKey, ...cloudRest } = normalized.cloud
  const onDisk = { ...normalized, cloud: { ...cloudRest, ...sealSecret(cloudKey) } }
  await fs.writeFile(aiConfigPath(userDataDir), JSON.stringify(onDisk, null, 2), 'utf8')
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
          : '还没选模型:去「AI 设置」展开模型货架,点「推荐模型」一键下载,或自己选一个 GGUF 文件'
      }
    }
    return {
      ok: true,
      // 内置引擎是自己家的 llama-server,认 timings_per_token / stream_options 旗子(第八十四锤)
      target: {
        baseUrl: builtinRuntime.baseUrl,
        model: builtinRuntime.model,
        timings: true,
        engine: 'builtin'
      }
    }
  }
  if (config.provider === 'cloud') return resolveCloudTarget(config.cloud)
  if (!config.lmstudio.model.trim()) {
    return { ok: false, message: '还没选模型:去「AI 设置」连一下 LM Studio' }
  }
  return {
    ok: true,
    target: {
      baseUrl: config.lmstudio.baseUrl,
      model: config.lmstudio.model,
      apiKey: config.lmstudio.apiKey || undefined,
      engine: 'lmstudio'
    }
  }
}

/** 在线 API 的收敛:未确认隐私 / 缺地址 / 缺 Key / 缺模型,各给一句指路话 */
function resolveCloudTarget(
  cloud: AiCloudSettings
): { ok: true; target: ChatTarget } | { ok: false; message: string } {
  if (!cloud.consented) {
    return { ok: false, message: '在线 API 还没确认:去「AI 设置」重新选择「在线 API」并确认' }
  }
  if (!cloud.baseUrl.trim()) return { ok: false, message: '还没填服务地址:去「AI 设置」填写' }
  if (!cloud.apiKey.trim()) return { ok: false, message: '还没填 API Key:去「AI 设置」填写' }
  if (!cloud.model.trim()) {
    return { ok: false, message: '还没选模型:去「AI 设置」点「读取模型」或手动填写模型名' }
  }
  return {
    ok: true,
    target: {
      baseUrl: cloud.baseUrl,
      model: cloud.model,
      apiKey: cloud.apiKey,
      engine: 'cloud'
    }
  }
}
