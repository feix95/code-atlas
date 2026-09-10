// ── 第一百一十三锤:个性化(说话方式)──
// 用户想让 AI 怎么跟他说话:整体语气 + 一段自订指令。
// 这里只管两件纯事:拼成提示词、把脏存档洗干净 —— 不碰配置读写,不碰界面。
//
// 一条铁律写在装配函数里:自订指令只改说法,不改事实 —— 所以风格段后面永远跟着
// 一句 HONESTY_TAIL,把「不许编造」这几条重新钉一遍。顺序本身就是优先级。

/** 整体语气(第一百一十八锤补,小葵定的三档人设):友善 / 专业 / 幽默;没有「默认」档,默认就是友善 */
export type ToneKey = 'friendly' | 'professional' | 'humorous'

export interface PersonalizationConfig {
  tone: ToneKey
  /** 用户自己写的说法要求 */
  custom: string
}

/** 自订指令的字数上限:再长就是拿上下文换废话了 */
export const CUSTOM_MAX = 500

export const TONE_OPTIONS: Array<{ key: ToneKey; label: string; hint: string }> = [
  { key: 'friendly', label: '友善', hint: '温暖且健谈' },
  { key: 'professional', label: '专业', hint: '讲究且细致' },
  { key: 'humorous', label: '幽默', hint: '轻松且直白' }
]

export const DEFAULT_PERSONALIZATION: PersonalizationConfig = {
  tone: 'friendly',
  custom: ''
}

const TONE_LINES: Record<ToneKey, string> = {
  // 三档人设的 prompt 都是小葵逐字定的(第一百一十八锤补),改一个字先问她;
  // 没有「默认」档:默认就是友善,照样加这段
  friendly:
    '你是一个友善、温暖、健谈的人。说话像跟好朋友聊天,语气自然有温度,会主动关心对方、记得细节、顺着情绪接话。健谈但不啰嗦,适当展开想法或小故事,让对话流动。真诚喜欢对方,用温和玩笑和鼓励拉近距离。对方开心一起高兴,低落时先接住情绪。不说教、不冷冰冰。语言口语化,像面对面聊天。让对话舒服、有温度、让人想继续聊。',
  professional:
    '你是一位专注于项目与代码讲解的专业导师。性格冷静、耐心、有分寸,像经验丰富的前辈在认真带人。核心注意力始终放在用户哪里还没真正懂上:主动察觉理解漏洞,把模糊的地方讲清楚,把容易卡住的点拆开。不急着给结论或方案,先帮用户把逻辑理顺、把盲区补上。语气沉稳克制,不废话、不卖弄,只让用户真正看懂。',
  humorous:
    '你自称哥,说话生动有趣,热情洋溢,充满活人感。你理性且同时具有人情味,最喜欢说大白话。始终先关注用户哪里可能还没懂,再用好玩又清楚的方式把那个点讲透。整体氛围轻松、有活力。喜欢用生活里的小比喻、夸张的对比、或者突然的神转折,把复杂的项目结构或代码逻辑讲得生动起来。'
}

/** 风格段后面永远跟着的这一句:把铁律重新钉一遍 —— 位置在最后,顺序就是优先级 */
export const HONESTY_TAIL =
  '以上偏好只改你说话的方式,不改事实:仍然只依据给定的资料说话,不许编造;该点名真实函数或类名的地方照旧点名;看不出来的地方照旧明说。'

/**
 * 把个性化拼成一段提示词(纯函数,自测覆盖)。
 * 风格段永远非空 —— 语气没有空档,默认就是友善。
 */
export function buildPersonalizationPrompt(p: PersonalizationConfig): string {
  const lines: string[] = []
  lines.push(TONE_LINES[p.tone])
  const rawCustom = p.custom.trim()
  // 最后一道闸:这里是文本进模型前的最后一站,超长的就地裁断并留省略号(读档那边也会裁)
  const custom = rawCustom.length > CUSTOM_MAX ? `${rawCustom.slice(0, CUSTOM_MAX)}……` : rawCustom
  if (custom) lines.push(`用户自己提的说法要求(优先级最高,但仍不许越过上面的事实铁律):\n«${custom}»`)
  return ['【这个用户偏好的说话方式】', ...lines].join('\n')
}

/**
 * 人设 + 风格段 + 铁律尾(纯函数,自测覆盖)。
 * style 为空就原样返回人设 —— 没个性化的人拿到的是逐字相同的旧提示词。
 */
export function withPersonalization(system: string, style: string): string {
  return style ? `${system}\n\n${style}\n${HONESTY_TAIL}` : system
}

/** 读档洗一遍(纯函数,自测覆盖):形状不对回默认,认不出的键值忽略,自订指令裁到上限 */
export function sanitizePersonalization(raw: unknown): PersonalizationConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PERSONALIZATION }
  const r = raw as Record<string, unknown>
  return {
    tone: TONE_OPTIONS.some((t) => t.key === r.tone) ? (r.tone as ToneKey) : DEFAULT_PERSONALIZATION.tone,
    custom: typeof r.custom === 'string' ? r.custom.trim().slice(0, CUSTOM_MAX) : ''
  }
}
