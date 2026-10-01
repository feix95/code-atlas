// 在线 API 服务商预设表(配置驱动):新增服务商只加一行,核心逻辑不动。
// 地址均取自各家官方文档的 OpenAI 兼容入口(base_url),用户可在设置里手改。

export type CloudVendorId =
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'dashscope'
  | 'siliconflow'
  | 'openrouter'
  | 'openai'
  | 'custom'

export interface CloudVendor {
  id: CloudVendorId
  label: string
  /** OpenAI 兼容入口;custom 为空串,由用户自填 */
  baseUrl: string
  /** 官方接入文档(设置页「接入文档」链接);custom 无 */
  docsUrl?: string
}

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
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    docsUrl: 'https://docs.bigmodel.cn/cn/api/introduction'
  },
  {
    id: 'dashscope',
    label: '通义千问(阿里云百炼)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    docsUrl: 'https://www.alibabacloud.com/help/en/model-studio/base-url'
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    docsUrl: 'https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/docs'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/docs'
  },
  { id: 'custom', label: '自定义(OpenAI 兼容)', baseUrl: '' }
]

export const DEFAULT_CLOUD_VENDOR: CloudVendorId = 'deepseek'

/** 在线 API 按 token 计费:默认上下文取 32k,够用且不至于每轮把账单撑大;用户可手动调高 */
export const CLOUD_DEFAULT_CONTEXT = 32768

/** 设置页「上下文窗口」可选档位(在线 API 无法探测上下文,只给固定档) */
export const CLOUD_CONTEXT_CHOICES: readonly number[] = [16384, 32768, 65536, 131072]

export function findCloudVendor(id: unknown): CloudVendor | undefined {
  return CLOUD_VENDORS.find((v) => v.id === id)
}

export function sanitizeCloudVendorId(id: unknown): CloudVendorId {
  return findCloudVendor(id)?.id ?? DEFAULT_CLOUD_VENDOR
}

/** 上下文落账:只认档位表里的数,其余一律回默认 */
export function sanitizeCloudContext(value: unknown): number {
  return typeof value === 'number' && CLOUD_CONTEXT_CHOICES.includes(value)
    ? value
    : CLOUD_DEFAULT_CONTEXT
}
