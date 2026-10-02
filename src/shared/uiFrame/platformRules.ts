// 平台规范校验(§5.7):实时提醒,不强制拦截。阈值随方案平台分档;问卷 D9「重点照顾」档
// 留 strict 参数,问卷上线后由调用方传入。纯函数,渲染层与自测共用。
import { componentCss } from './recipes/kit.ts'
import { RECIPES } from './recipes/index.ts'
import { resolveValue } from './resolve.ts'
import type { LintLevel, ThemeName, UiFrameDoc, UiPlatform } from './types.ts'

export interface PlatformIssue {
  /** §5.7 规则名(点击区 / 文字对比度 / …) */
  rule: string
  level: LintLevel
  /** 出问题的变量名(-- 前缀省略);组件级问题记 `组件:<id>` */
  target: string
  message: string
}

/** 最小点击区阈值(§5.7):手机按 iOS 44pt(Android 48 在提醒文案里给出);电脑按 WCAG 2.2 的 24 */
const TOUCH_MIN: Record<UiPlatform, { min: number; hint: string }> = {
  phone: { min: 44, hint: 'iOS 44pt / Android 48dp' },
  desktop: { min: 24, hint: 'WCAG 24px,建议 32 以上' }
}

/** 正文字号下限(§5.7):手机 14 / 电脑 12;问卷 D9「需要重点照顾」→ 加强档再 +2 */
const BODY_FONT_MIN: Record<UiPlatform, number> = { phone: 14, desktop: 12 }
/** 加强档(§5.7 D9):正文对比度 4.5→7(AAA),控件边界 3→4.5,字号下限 +2 */
const A11Y_TEXT_MIN = { normal: 4.5, enhanced: 7 }
const A11Y_BOUNDARY_MIN = { normal: 3, enhanced: 4.5 }

/** 可作为点击区的控件变量名:控件高度档、图标按钮尺寸、复选框尺寸、开关轨道等 */
const HIT_TARGET_RE =
  /^(control-(sm|md|lg)|(?:btn|ipt)-height-(sm|md|lg)|ibtn-size-(sm|md|lg)|chk-size-(sm|md)|sw-(width|height)-(sm|md))$/

/** 文字对比度配对(§5.7 WCAG AA ≥4.5):语义色正文组合,亮暗两套都查 */
const TEXT_PAIRS: Array<[string, string]> = [
  ['color-text', 'color-bg'],
  ['color-text', 'color-surface'],
  ['color-text-secondary', 'color-bg'],
  ['color-text-secondary', 'color-surface'],
  ['color-on-primary', 'color-primary'],
  ['color-primary', 'color-primary-subtle']
]

/** 控件边界对比度配对(§5.7 WCAG 1.4.11 ≥3):输入框/开关/焦点环等控件边界与相邻底 */
const BOUNDARY_PAIRS: Array<[string, string]> = [
  ['color-border', 'color-bg'],
  ['color-border', 'color-surface'],
  ['color-border-strong', 'color-bg'],
  ['color-border-strong', 'color-surface'],
  ['sw-off-border', 'color-surface'],
  ['color-focus', 'color-bg']
]

const THEMES: ThemeName[] = ['light', 'dark']

function hexRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => `${c}${c}`).join('')
  if (h.length === 8) h = h.slice(0, 6)
  if (h.length !== 6) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 对比度;任一颜色不是十六进制时回 null(跳过核算) */
export function contrastRatio(a: string, b: string): number | null {
  const ra = hexRgb(a)
  const rb = hexRgb(b)
  if (!ra || !rb) return null
  const [l1, l2] = [luminance(ra), luminance(rb)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** 追到引用链末端的变量名;断链回 null(断链本身另有「引用失效」报错) */
function terminalName(doc: UiFrameDoc, name: string): string | null {
  let current = doc.tokens[name]
  for (let depth = 0; depth < 8; depth++) {
    if (!current) return null
    if (current.value.kind !== 'ref') return name
    const next = current.value.ref
    current = doc.tokens[next]
    name = next
  }
  return null
}

function resolvedPx(doc: UiFrameDoc, name: string): number | null {
  try {
    const v = resolveValue(doc.tokens, name)
    return v.kind === 'dimension' ? v.px : null
  } catch {
    return null
  }
}

function resolvedColor(doc: UiFrameDoc, name: string, theme: ThemeName): string | null {
  try {
    const v = resolveValue(doc.tokens, name)
    return v.kind === 'color' ? v[theme] : null
  } catch {
    return null
  }
}

/** §5.7 实时校验:输入整份方案,出分级问题清单(warn 提醒 / error 报错) */
export function platformIssues(doc: UiFrameDoc): PlatformIssue[] {
  const issues: PlatformIssue[] = []
  const push = (rule: string, level: LintLevel, target: string, message: string): void => {
    issues.push({ rule, level, target, message })
  }

  // 引用失效:ref 指向不存在的变量(§5.7 记为报错)
  for (const [name, def] of Object.entries(doc.tokens)) {
    if (def.value.kind === 'ref' && !doc.tokens[def.value.ref]) {
      push('引用失效', 'error', name, `--${name} 引用不存在的 --${def.value.ref}`)
    }
  }

  // 非步长数值:① 任何尺寸变量(字号阶梯豁免)出现小数 px;② 间距/圆角/控件/图标类
  // 整数但离 0.125rem 网格(radius-full 的 999 这类刻意值与描边/内缩微调豁免)
  const stepPx = doc.rootFontPx / 8
  const GRID_GROUPS = new Set(['space', 'control', 'icon', 'avatar'])
  for (const [name, def] of Object.entries(doc.tokens)) {
    if (def.value.kind !== 'dimension' || def.path[0] === 'font-size') continue
    if (!Number.isInteger(def.value.px)) {
      push('非步长数值', 'warn', name, `--${name} = ${def.value.px}px:出现小数像素`)
      continue
    }
    if (name === 'radius-full') continue
    if ((GRID_GROUPS.has(def.path[0]) || def.path[0] === 'radius') && def.value.px % stepPx !== 0) {
      push(
        '非步长数值',
        'warn',
        name,
        `--${name} = ${def.value.px}px,不在 0.125rem(${stepPx}px)网格上`
      )
    }
  }

  // 最小点击区:按变量名归集到末端基础变量,同一个基础变量只提醒一次
  const touch = TOUCH_MIN[doc.platform]
  const hit = new Map<string, { px: number; via: string[] }>()
  for (const name of Object.keys(doc.tokens)) {
    if (!HIT_TARGET_RE.test(name)) continue
    const term = terminalName(doc, name)
    if (!term) continue
    const px = resolvedPx(doc, term)
    if (px === null) continue
    const slot = hit.get(term) ?? { px, via: [] }
    slot.via.push(`--${name}`)
    hit.set(term, slot)
  }
  for (const [term, { px, via }] of [...hit.entries()].sort((a, b) => a[1].px - b[1].px)) {
    if (px >= touch.min) continue
    const viaText =
      via.length === 1 && via[0] === `--${term}`
        ? ''
        : `;经 ${via.length} 个控件变量引用(${via.slice(0, 3).join('、')} 等)`
    push(
      '最小点击区',
      'warn',
      term,
      `--${term} = ${px}px,低于最小点击区 ${touch.min}px(${touch.hint})${viaText}`
    )
  }

  // 文字对比度 ≥4.5(WCAG AA 正文);加强档 ≥7(AAA)
  const enhanced = doc.a11yEnhanced === true
  const textMin = enhanced ? A11Y_TEXT_MIN.enhanced : A11Y_TEXT_MIN.normal
  const boundaryMin = enhanced ? A11Y_BOUNDARY_MIN.enhanced : A11Y_BOUNDARY_MIN.normal
  for (const [fg, bg] of TEXT_PAIRS) {
    for (const theme of THEMES) {
      const a = resolvedColor(doc, fg, theme)
      const b = resolvedColor(doc, bg, theme)
      if (a === null || b === null) continue
      const ratio = contrastRatio(a, b)
      if (ratio === null) {
        push('文字对比度', 'warn', fg, `--${fg} 含非十六进制颜色,对比度未核算`)
        continue
      }
      if (ratio < textMin) {
        push(
          '文字对比度',
          'warn',
          fg,
          `${theme === 'light' ? '亮色' : '暗色'}下 --${fg} 对 --${bg} 为 ${ratio.toFixed(2)}:1,低于正文 ${textMin}:1${enhanced ? '(加强档)' : ''}`
        )
      }
    }
  }

  // 控件边界对比度 ≥3(WCAG 1.4.11)
  for (const [fg, bg] of BOUNDARY_PAIRS) {
    for (const theme of THEMES) {
      const a = resolvedColor(doc, fg, theme)
      const b = resolvedColor(doc, bg, theme)
      if (a === null || b === null) continue
      const ratio = contrastRatio(a, b)
      if (ratio === null) continue
      if (ratio < boundaryMin) {
        push(
          '控件边界对比度',
          'warn',
          fg,
          `${theme === 'light' ? '亮色' : '暗色'}下 --${fg} 对 --${bg} 为 ${ratio.toFixed(2)}:1,低于控件边界 ${boundaryMin}:1${enhanced ? '(加强档)' : ''}`
        )
      }
    }
  }

  // 正文字号下限:正文档 font-size-md 按平台查;加强档再 +2
  const bodyPx = resolvedPx(doc, 'font-size-md')
  const bodyMin = BODY_FONT_MIN[doc.platform] + (enhanced ? 2 : 0)
  if (bodyPx !== null && bodyPx < bodyMin) {
    push(
      '正文字号下限',
      'warn',
      'font-size-md',
      `--font-size-md = ${bodyPx}px,低于${doc.platform === 'phone' ? '手机' : '电脑'}端正文 ${bodyMin}px${enhanced ? '(加强档)' : ''}`
    )
  }

  // 状态缺失:焦点态两端都要,悬停态只在电脑端查(手机没有悬停);
  // 无交互的纯展示组件(卡片/提示气泡 states 为空)不查
  for (const recipe of RECIPES) {
    if (recipe.states.length === 0) continue
    const required = recipe.requiredStates ?? [':hover', ':active', ':focus-visible', ':disabled']
    const css = componentCss(recipe)
    if (required.some((s) => s.includes('focus')) && !css.includes('focus-visible')) {
      push('焦点态缺失', 'warn', `组件:${recipe.id}`, `${recipe.label} 缺键盘焦点态`)
    }
    if (
      doc.platform === 'desktop' &&
      required.some((s) => s === ':hover') &&
      !css.includes(':hover')
    ) {
      push('悬停态缺失', 'warn', `组件:${recipe.id}`, `${recipe.label} 缺悬停态`)
    }
  }

  return issues
}
