// ── 第一百一十三锤:个性化(说话方式)──
// 用户想让 AI 怎么跟他说话:整体语气 + 一段自订指令。
// 这里只管两件纯事:拼成提示词、把脏存档洗干净 —— 不碰配置读写,不碰界面。
//
// 包裹规矩(提示词体系 2.0):风格段整个包在 <style_preference> 里,用户手写的那句
// 再单独包 <custom_request> —— 标签里是用户偏好,改说法不改事实;诚实边界由内核统管,
// 不再单独垫尾巴(2.0 内核已含「如实相告、承认不确定」)。

/** 整体语气(第一百一十八锤补,小葵定的三档人设;第一百五十一锤加回「默认」档):
 * 默认 = 不垫任何语气人设,模型原汁原味;友善 / 专业 / 幽默 才是真的垫人设 */
export type ToneKey = 'default' | 'friendly' | 'professional' | 'humorous'

/** 讲解深度(教学三档):off = 只说这东西干什么、不教学不列术语;brief = 先骨架后细节 + 名词小课堂精简版;deep = 骨架 + 语言与写法 + 细节点到为止 + 名词小课堂详细版 */
export type TeachingLevel = 'off' | 'brief' | 'deep'

export interface PersonalizationConfig {
  tone: ToneKey
  /** 讲解深度(教学三档):讲代码和文件时讲多细 */
  teaching: TeachingLevel
  /** 用户自己写的说法要求 */
  custom: string
}

/** 自订指令的字数上限:再长就是拿上下文换废话了 */
export const CUSTOM_MAX = 500

export const TONE_OPTIONS: Array<{ key: ToneKey; label: string; hint: string }> = [
  { key: 'default', label: '默认', hint: '不指定语气,原汁原味' },
  { key: 'friendly', label: '友善', hint: '温暖且健谈' },
  { key: 'professional', label: '专业', hint: '讲究且细致' },
  { key: 'humorous', label: '幽默', hint: '轻松且直白' }
]

/** 讲解深度三档(AI 提示词体系重写第一批,小葵定的档名和介绍):档位的提示词文本(教学切片)住在 ai/prompts.ts,不进风格段 —— 讲法和语气是两路 */
export const TEACHING_OPTIONS: Array<{ key: TeachingLevel; label: string; hint: string }> = [
  { key: 'off', label: '简洁', hint: '只说是干什么的' },
  { key: 'brief', label: '精简', hint: '先骨架，带名词小课堂' },
  { key: 'deep', label: '详细', hint: '骨架+语言写法+细节' }
]

export const DEFAULT_PERSONALIZATION: PersonalizationConfig = {
  tone: 'default',
  teaching: 'brief',
  custom: ''
}

const TONE_LINES: Record<Exclude<ToneKey, 'default'>, string> = {
  // 三档人设的 prompt 都是小葵逐字定的(提示词体系重写第二批换的新稿),改一个字先问她;
  // 「默认」档不住这里:它代表不垫语气,buildPersonalizationPrompt 里直接跳过
  friendly:
    '你说话友善、温暖、健谈,像跟好朋友聊天:语气自然有温度,会关心对方、记得细节、顺着情绪接话。健谈但不啰嗦,适当展开想法,让对话流动。用温和的玩笑和鼓励拉近距离;对方开心就一起高兴,低落时先接住情绪。不说教、不冷冰冰。',
  professional:
    '你说话专业、冷静、有分寸,像经验丰富的前辈在认真说话。用词讲究、条理清楚,不废话、不卖弄、不套话。语气沉稳克制,该下判断就给明确判断,拿不准就明确说拿不准。',
  humorous:
    '你说话生动有趣,热情洋溢,充满活人感 —— 理性但有人情味,最爱说大白话。喜欢用生活里的小比喻、夸张的对比、突然的神转折,把话说得有意思。整体氛围轻松、有活力,不端着。'
}

/**
 * 把个性化拼成一段提示词(纯函数,自测覆盖)。
 * 全默认(语气默认 + 没写自订指令)时返回空串 —— 人设一字不加,模型原汁原味。
 */
export function buildPersonalizationPrompt(p: PersonalizationConfig): string {
  const lines: string[] = []
  if (p.tone !== 'default') lines.push(TONE_LINES[p.tone])
  const rawCustom = p.custom.trim()
  // 最后一道闸:这里是文本进模型前的最后一站,超长的就地裁断并留省略号(读档那边也会裁)
  const custom = rawCustom.length > CUSTOM_MAX ? `${rawCustom.slice(0, CUSTOM_MAX)}……` : rawCustom
  if (custom) lines.push(`用户自己提的说法要求:\n<custom_request>\n${custom}\n</custom_request>`)
  if (lines.length === 0) return ''
  return ['<style_preference>', '这个用户偏好的说话方式:', ...lines, '以上只改你说话的方式。', '</style_preference>'].join('\n')
}

/**
 * 人设 + 风格段(纯函数,自测覆盖)。
 * style 为空就原样返回人设 —— 没个性化的人拿到的是逐字相同的旧提示词。
 */
export function withPersonalization(system: string, style: string): string {
  return style ? `${system}\n\n${style}` : system
}

/** 读档洗一遍(纯函数,自测覆盖):形状不对回默认,认不出的键值忽略,自订指令裁到上限 */
export function sanitizePersonalization(raw: unknown): PersonalizationConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PERSONALIZATION }
  const r = raw as Record<string, unknown>
  return {
    tone: TONE_OPTIONS.some((t) => t.key === r.tone) ? (r.tone as ToneKey) : DEFAULT_PERSONALIZATION.tone,
    teaching: TEACHING_OPTIONS.some((t) => t.key === r.teaching) ? (r.teaching as TeachingLevel) : DEFAULT_PERSONALIZATION.teaching,
    custom: typeof r.custom === 'string' ? r.custom.trim().slice(0, CUSTOM_MAX) : ''
  }
}
