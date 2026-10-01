// 在线 API 服务商预设表(配置驱动):新增服务商只加一行,核心逻辑不动。
// 地址均取自各家官方文档的 OpenAI 兼容入口(base_url),用户可在设置里手改。
import { CONTEXT_SIZE_MAX, CONTEXT_SIZE_MIN } from './aiDefaults.ts'

export type CloudVendorId =
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'anthropic'
  | 'gemini'
  | 'xai'
  | 'openai'
  | 'openrouter'
  | 'custom'

export interface CloudVendor {
  id: CloudVendorId
  label: string
  /** OpenAI 兼容入口;custom 为空串,由用户自填 */
  baseUrl: string
  /** 官方接入文档(设置页「接入文档」链接);custom 无 */
  docsUrl?: string
}

// 排序约定:国内可直连的在前,国际按字母,聚合站(OpenRouter)随后,「自定义」垫底
export const CLOUD_VENDORS: readonly CloudVendor[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    docsUrl: 'https://api-docs.deepseek.com/'
  },
  {
    id: 'moonshot',
    label: 'Kimi(月之暗面)',
    baseUrl: 'https://api.moonshot.cn/v1',
    docsUrl: 'https://platform.kimi.com/docs/api/overview'
  },
  {
    id: 'zhipu',
    label: 'GLM(智谱)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    docsUrl: 'https://docs.bigmodel.cn/cn/api/introduction'
  },
  {
    id: 'anthropic',
    label: 'Claude(Anthropic)',
    baseUrl: 'https://api.anthropic.com/v1/',
    docsUrl: 'https://docs.anthropic.com/en/api/openai-sdk'
  },
  {
    id: 'gemini',
    label: 'Gemini(Google)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai'
  },
  {
    id: 'xai',
    label: 'Grok(xAI)',
    baseUrl: 'https://api.x.ai/v1',
    docsUrl: 'https://docs.x.ai/developers/model-capabilities/text/generate-text'
  },
  {
    id: 'openai',
    label: 'GPT(OpenAI)',
    baseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/docs'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/docs'
  },
  { id: 'custom', label: '自定义(OpenAI 兼容)', baseUrl: '' }
]

export const DEFAULT_CLOUD_VENDOR: CloudVendorId = 'deepseek'

/** 在线 API 按 token 计费:默认上下文取 128k,旗舰云端模型普遍支持;用户可手动调 16k~1M */
export const CLOUD_DEFAULT_CONTEXT = 131072

/** 设置页「上下文窗口」的快捷档位(在线 API 无法探测上下文);输入框可填 512~1M 任意值 */
export const CLOUD_CONTEXT_CHOICES: readonly number[] = [
  16384, 32768, 65536, 131072, 262144, 524288, 1048576
]

export function findCloudVendor(id: unknown): CloudVendor | undefined {
  return CLOUD_VENDORS.find((v) => v.id === id)
}

export function sanitizeCloudVendorId(id: unknown): CloudVendorId {
  return findCloudVendor(id)?.id ?? DEFAULT_CLOUD_VENDOR
}

/** 上下文落账:夹进 [CONTEXT_SIZE_MIN, CONTEXT_SIZE_MAX] 取整,非法值回默认 */
export function sanitizeCloudContext(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CLOUD_DEFAULT_CONTEXT
  const v = Math.floor(value)
  if (v < CONTEXT_SIZE_MIN || v > CONTEXT_SIZE_MAX) return CLOUD_DEFAULT_CONTEXT
  return v
}
