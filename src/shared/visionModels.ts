// 在线 API 的视觉模型名单(纯函数,自测覆盖)
// 在线服务没有统一的「能不能看图」查询口,只能按模型名认账 —— 命中已知视觉系
// 才敢报「视觉」;不命中一律 unknown,绝不冒充 text-only(名单外的模型说不准)。

import type { VisionSupport } from './types.ts'

/** 已知能看图的模型名特征(小写匹配);新视觉系往这里加 */
const VISION_NAME_PATTERNS: RegExp[] = [
  // OpenAI:gpt-4o / gpt-4.1 / gpt-5 / o 系 / chatgpt-4o-latest 这类
  /^gpt-4o/i,
  /^gpt-4\.1/i,
  /^gpt-5/i,
  /^o\d/i,
  /^chatgpt-4o/i,
  // Anthropic:claude 3 起都能看图(claude-3-*/claude-sonnet-4/claude-opus-4.x/claude-haiku-4.x)
  /claude-[a-z-]*(?:[3-9])/i,
  // Google:gemini 全系(1.5 起)都带视觉;gemini-1.0-pro 是纯文本
  /^gemini-(?!1\.0)/i,
  // 通义 Qwen VL 系:qwen-vl-* / qwen2-vl / qwen2.5-vl 等
  /qwen[\w.-]*vl/i,
  // 智谱 GLM 视觉系:glm-4v / glm-4.5v / glm-4v-plus
  /glm-[\d.]*v/i,
  // xAI:grok-vision / grok-2-vision / grok-4
  /grok-.*vision/i,
  /^grok-4/i,
  // 视觉系开源常客:llava / pixtral / minicpm-v / internvl / moondream / deepseek-vl
  /llava/i,
  /pixtral/i,
  /minicpm.*-v/i,
  /internvl/i,
  /moondream/i,
  /deepseek.*vl/i,
  // 兜底:名字里直接写 vision 的(grok-vision-beta 这类也在此列)
  /vision/i
]

/** 在线 API 的模型名 → 视觉能力:命中已知视觉系回 'vision',其余一律 'unknown'(不冒充 text-only) */
export function cloudVisionOf(modelName: string): VisionSupport {
  const name = modelName.trim()
  if (!name) return 'unknown'
  return VISION_NAME_PATTERNS.some((re) => re.test(name)) ? 'vision' : 'unknown'
}
