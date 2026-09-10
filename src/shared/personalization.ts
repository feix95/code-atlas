// ── 第一百一十三锤:个性化(说话方式)──
// 用户想让 AI 怎么跟他说话:整体语气 + 四个特质档位 + 一段自订指令。
// 这里只管两件纯事:拼成提示词、把脏存档洗干净 —— 不碰配置读写,不碰界面。
//
// 一条铁律写在装配函数里:自订指令只改说法,不改事实 —— 所以风格段后面永远跟着
// 一句 HONESTY_TAIL,把「不许编造」这几条重新钉一遍。顺序本身就是优先级。

/** 整体语气 */
export type ToneKey = 'default' | 'friendly' | 'professional' | 'direct' | 'warm'

/** 特质档位:更少 / 默认 / 更多 */
export type LevelKey = 'less' | 'default' | 'more'

export interface PersonalizationConfig {
  tone: ToneKey
  /** 对读者处境的体谅 */
  warmth: LevelKey
  /** 语气里的劲头 */
  enthusiasm: LevelKey
  /** 正文要不要分点分标题 */
  structure: LevelKey
  /** 用不用表情符号 */
  emoji: LevelKey
  /** 用户自己写的说法要求 */
  custom: string
}

/** 四个特质的键(语气和自订指令另算) */
export type TraitKey = 'warmth' | 'enthusiasm' | 'structure' | 'emoji'

/** 自订指令的字数上限:再长就是拿上下文换废话了 */
export const CUSTOM_MAX = 500

export const TONE_OPTIONS: Array<{ key: ToneKey; label: string }> = [
  { key: 'default', label: '默认' },
  { key: 'friendly', label: '友善' },
  { key: 'professional', label: '专业' },
  { key: 'direct', label: '直接' },
  { key: 'warm', label: '热情' }
]

export const LEVEL_OPTIONS: Array<{ key: LevelKey; label: string }> = [
  { key: 'less', label: '更少' },
  { key: 'default', label: '默认' },
  { key: 'more', label: '更多' }
]

/** 特质清单:界面按它排下拉、拼提示词也按它走 —— 一处定义,两边都认,加项只改这里 */
export const TRAITS: Array<{ key: TraitKey; label: string; hint: string }> = [
  { key: 'warmth', label: '温暖', hint: '对你处境的体谅程度' },
  { key: 'enthusiasm', label: '热情', hint: '语气里的劲头' },
  { key: 'structure', label: '标题和列表', hint: '正文要不要分点分层' },
  { key: 'emoji', label: '表情符号', hint: '只影响 AI 说的话,界面自己永远不出现表情' }
]

/**
 * 全默认的个性化:拿它拼出来是空字符串。
 * 这是「没动过这一栏的人,提示词一字不变」的保证 —— 老配置升级上来行为与从前逐字相同。
 */
export const DEFAULT_PERSONALIZATION: PersonalizationConfig = {
  tone: 'default',
  warmth: 'default',
  enthusiasm: 'default',
  structure: 'default',
  emoji: 'default',
  custom: ''
}

const TONE_LINES: Record<ToneKey, string> = {
  default: '',
  friendly: '语气随和一些,像同事之间说话,不用端着。',
  professional: '保持专业克制:用词准确,不寒暄、不闲聊、不卖萌。',
  direct: '开门见山:先给结论,再补必要的解释,别铺垫。',
  warm: '精神饱满一点,愿意多讲一句对他有用的;但别夸张,也别一味鼓励。'
}

const TRAIT_LINES: Record<TraitKey, Record<Exclude<LevelKey, 'default'>, string>> = {
  warmth: {
    more: '多体谅读者:他可能是新手,看不懂的地方多解释半句,别让他觉得是自己笨。',
    less: '少寒暄少共情,把话都用在事情上。'
  },
  enthusiasm: {
    more: '语气积极一点,该肯定的地方就肯定一句。',
    less: '语气平实,不用表达情绪。'
  },
  structure: {
    more: '要点多的时候就用列表或小标题分开,方便扫读。',
    // 「更少」只约束正文排版:结尾的「名词小课堂」是学习功能,不是排版花活,照旧保留
    less: '能用一段通顺的话说清就别列点,也别用标题分层(结尾的「名词小课堂」照旧保留)。'
  },
  emoji: {
    more: '可以适当用表情符号让语气活一点,但别滥用,一句话最多一个。',
    less: '不要用表情符号。'
  }
}

/** 风格段后面永远跟着的这一句:把铁律重新钉一遍 —— 位置在最后,顺序就是优先级 */
export const HONESTY_TAIL =
  '以上偏好只改你说话的方式,不改事实:仍然只依据给定的资料说话,不许编造;该点名真实函数或类名的地方照旧点名;看不出来的地方照旧明说。'

/**
 * 把个性化拼成一段提示词(纯函数,自测覆盖)。
 * 全默认返回空串 —— 空串意味着「一个字都不加」,不是「加一句说默认」。
 */
export function buildPersonalizationPrompt(p: PersonalizationConfig): string {
  const lines: string[] = []
  const tone = TONE_LINES[p.tone]
  if (tone) lines.push(tone)
  for (const trait of TRAITS) {
    const level = p[trait.key]
    if (level !== 'default') lines.push(TRAIT_LINES[trait.key][level])
  }
  const rawCustom = p.custom.trim()
  // 最后一道闸:这里是文本进模型前的最后一站,超长的就地裁断并留省略号(读档那边也会裁)
  const custom = rawCustom.length > CUSTOM_MAX ? `${rawCustom.slice(0, CUSTOM_MAX)}……` : rawCustom
  if (custom) lines.push(`用户自己提的说法要求(优先级最高,但仍不许越过上面的事实铁律):\n«${custom}»`)
  if (lines.length === 0) return ''
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
  const level = (v: unknown, fallback: LevelKey): LevelKey => (v === 'less' || v === 'default' || v === 'more' ? v : fallback)
  return {
    tone: TONE_OPTIONS.some((t) => t.key === r.tone) ? (r.tone as ToneKey) : DEFAULT_PERSONALIZATION.tone,
    warmth: level(r.warmth, DEFAULT_PERSONALIZATION.warmth),
    enthusiasm: level(r.enthusiasm, DEFAULT_PERSONALIZATION.enthusiasm),
    structure: level(r.structure, DEFAULT_PERSONALIZATION.structure),
    emoji: level(r.emoji, DEFAULT_PERSONALIZATION.emoji),
    custom: typeof r.custom === 'string' ? r.custom.trim().slice(0, CUSTOM_MAX) : ''
  }
}
