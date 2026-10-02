// 问卷答案 → 第二步初始值(§2「答案预填」、§3.6 回填)。
// 只产出确定性的映射结果:平台、起步模板、密度与主色的变量覆盖;怎么用它由界面层决定。

import type { TokenValue, UiPlatform } from '../uiFrame/types.ts'
import type { AnswerMap } from './types.ts'

const picked = (answers: AnswerMap, qid: string, ...ids: string[]): boolean => {
  const a = answers[qid]
  return a?.kind === 'options' && ids.some((id) => a.ids.includes(id))
}
const one = (answers: AnswerMap, qid: string): string | null => {
  const a = answers[qid]
  return a?.kind === 'options' ? (a.ids[0] ?? null) : null
}

/** G1 风格 → 已实现模板的映射;§8.2 九风格里四个未实现(选它们记进立项单,不预填) */
const STYLE_TEMPLATE: Record<string, string> = {
  minimal: 'minimal-desk',
  modern: 'modern-desk',
  tinted: 'tint-phone',
  airy: 'airy-phone'
}

const px = (v: number): TokenValue => ({ kind: 'dimension', px: v })
const even = (v: number): number => Math.round(v / 2) * 2

/** 空间与控件档:密度换算的作用对象(space-1…24 与 control-sm/md/lg) */
const DENSITY_TOKENS = [
  'space-1',
  'space-2',
  'space-3',
  'space-4',
  'space-6',
  'space-8',
  'space-10',
  'space-16',
  'space-24',
  'control-sm',
  'control-md',
  'control-lg'
]
const BASE_PX: Record<string, number> = {
  'space-1': 4,
  'space-2': 8,
  'space-3': 12,
  'space-4': 16,
  'space-6': 24,
  'space-8': 32,
  'space-10': 40,
  'space-16': 64,
  'space-24': 96,
  'control-sm': 32,
  'control-md': 40,
  'control-lg': 48
}
/** G4 密度 → 缩放系数,结果四舍五入回 2px 步长网格 */
const DENSITY_SCALE: Record<string, number> = { roomy: 1.2, compact: 0.85 }

export interface QuizPrefill {
  platform: UiPlatform
  /** 匹配到的内置模板 id;无匹配(null)= 空白起步 */
  templateId: string | null
  /** 密度/主色换算出的变量覆盖,叠在所选模板之上 */
  overrides: Record<string, TokenValue>
  /** G1 选的风格名(含未实现风格),供界面层提示用 */
  styleId: string | null
  /** D9 选「需要重点照顾」→ §5.7 加强档校验 */
  a11yEnhanced: boolean
}

/** A1 含手机/平板 → phone;桌面/网页/小程序 → desktop(网页先按电脑端画布,§22-4) */
export function quizPrefill(answers: AnswerMap): QuizPrefill {
  const platform: UiPlatform = picked(answers, 'A1', 'phone', 'tablet') ? 'phone' : 'desktop'
  const styleId = one(answers, 'G1')
  const templateId = styleId ? (STYLE_TEMPLATE[styleId] ?? null) : null

  const overrides: Record<string, TokenValue> = {}
  const density = one(answers, 'G4')
  const scale = density ? DENSITY_SCALE[density] : undefined
  if (scale) {
    for (const key of DENSITY_TOKENS) {
      overrides[key] = px(even(BASE_PX[key] * scale))
    }
  }
  if (one(answers, 'G3') === 'have') {
    const a = answers['G3']
    const hex = a?.kind === 'options' ? a.extra?.trim() : null
    if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
      overrides['color-primary'] = { kind: 'color', light: hex, dark: hex }
    }
  }
  return {
    platform,
    templateId,
    overrides,
    styleId,
    a11yEnhanced: picked(answers, 'D9', 'enhanced')
  }
}
