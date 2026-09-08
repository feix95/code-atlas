// 外观系统:亮暗模式 + 配色预设 + 自定义主题色/辅助色。
// 偏好存 localStorage(界面的事,每台机器自己一套,不进 AI 配置文件)。
// 生效方式:模式往 <html> 上挂 data-theme 切换样式表里的两套 token;
// 自定义色在启动时算出一族同色系的 token 写到 :root 内联样式上,压过样式表默认值。

export type AppearanceMode = 'auto' | 'light' | 'dark'
/** preset 和自定义色互斥:选了预设就清空自定义色,点「自定义」才进 custom 档 */
export type AppearancePreset = 'default' | 'teal' | 'violet' | 'custom'

export interface Appearance {
  mode: AppearanceMode
  preset: AppearancePreset
  /** 自定义主题色(#rrggbb);不设就跟预设走 */
  accent: string | null
  /** 自定义辅助色(#rrggbb);不设就跟预设走 */
  secondary: string | null
}

export const APPEARANCE_KEY = 'atlas.appearance'

/** 配色预设:雾空蓝 = 现在的默认皮肤(不写任何内联,和从前一模一样);另两套是现成的成套配色 */
export const COLOR_PRESETS: Array<{ key: AppearancePreset; name: string; accent: string; secondary: string }> = [
  { key: 'default', name: '雾空蓝', accent: '#147dcc', secondary: '#5ac5db' },
  { key: 'teal', name: '青碧', accent: '#0e9488', secondary: '#56c3ad' },
  { key: 'violet', name: '丁香紫', accent: '#7c5cd6', secondary: '#b79ef0' }
]

/** 由主题色派生的整族 token:派生时一次性全换,保持互相搭配
 *  (--secondary-deep 是辅助色的文字安全档;--line 边框线归辅助色管;
 *   --canvas-tint 不在列 —— 第七十七锤起画布回归固定中性底,不再跟主题色染) */
const TOKEN_KEYS = [
  '--accent',
  '--accent-hover',
  '--accent-ink',
  '--accent-soft',
  '--accent-line',
  '--selected-bg',
  '--secondary',
  '--secondary-deep',
  '--line'
] as const

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Appearance>
      return {
        mode: p.mode === 'light' || p.mode === 'dark' ? p.mode : 'auto',
        preset: p.preset === 'teal' || p.preset === 'violet' || p.preset === 'custom' ? p.preset : 'default',
        accent: isHexColor(p.accent) ? p.accent : null,
        secondary: isHexColor(p.secondary) ? p.secondary : null
      }
    }
  } catch {
    // 存档坏了就当没配过,回到默认,不炸界面
  }
  return { mode: 'auto', preset: 'default', accent: null, secondary: null }
}

export function saveAppearance(a: Appearance): void {
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a))
}

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/** #rgb / #rrggbb → HSL(h∈[0,360), s/l∈[0,100]);自测要拿真实 hex 走同一条路,导出 */
export function hexToHsl(hex: string): [number, number, number] {
  let m = hex.replace('#', '')
  if (m.length === 3) m = m.split('').map((c) => c + c).join('')
  const r = parseInt(m.slice(0, 2), 16) / 255
  const g = parseInt(m.slice(2, 4), 16) / 255
  const b = parseInt(m.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return [h, s * 100, l * 100]
}

function hslCss(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`
}

/** 实心主题色上两个字色的候选:深墨(暗色主题历来压按钮的深字)/ 纯白 */
const INK_DARK = '#10222e'
const INK_LIGHT = '#ffffff'

/** HSL → WCAG 相对亮度(0~1,算对比度用) */
export function hslLuminance(h: number, s: number, l: number): number {
  const sat = s / 100
  const lig = l / 100
  const c = (1 - Math.abs(2 * lig - 1)) * sat
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = lig - c / 2
  const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r1 + m) + 0.7152 * lin(g1 + m) + 0.0722 * lin(b1 + m)
}

/** 实心主题色按钮上的字色:深墨/白谁对比高听谁的(纯函数,自测覆盖)。
 * 阈值卡在两者打平点偏白一档:亮色主题三套预设照旧白字;
 * 暗色主题紫系从深字翻白字(对比 3.4 → 4.8,更清楚)。
 */
export function pickAccentInk(h: number, s: number, l: number): string {
  return hslLuminance(h, s, l) >= 0.25 ? INK_DARK : INK_LIGHT
}

/** 当前该亮还是该暗:手动模式听用户的,自动模式听系统的 */
export function isDarkNow(a: Appearance): boolean {
  if (a.mode === 'dark') return true
  if (a.mode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyAppearance(a: Appearance): void {
  const dark = isDarkNow(a)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'

  const root = document.documentElement.style
  // 原装预设 + 没动过颜色:一个内联都不写,皮肤完全交给样式表,和从前一模一样
  if (a.preset === 'default' && !a.accent && !a.secondary) {
    for (const key of TOKEN_KEYS) root.removeProperty(key)
    return
  }

  // 预设与自定义分家:custom 档直接用用户选的色,绝不跟某个预设攀亲戚;
  // 万一 custom 状态下颜色缺了(老存档坏了,理论上不该发生),整套回退晴空蓝固定色,不炸界面
  let accentHex: string
  let secondaryHex: string
  /** 自定义档 = 用户亲手选的色,给满自由;预设档 = 配好的成套皮肤,里子保持原配档 */
  const free = a.preset === 'custom'
  if (free) {
    const fallback = COLOR_PRESETS[0]
    accentHex = a.accent ?? fallback.accent
    secondaryHex = a.secondary ?? fallback.secondary
  } else {
    const preset = COLOR_PRESETS.find((p) => p.key === a.preset) ?? COLOR_PRESETS[0]
    accentHex = a.accent ?? preset.accent
    secondaryHex = a.secondary ?? preset.secondary
  }
  const [h, s, l] = hexToHsl(accentHex)
  const [h2, s2, l2] = hexToHsl(secondaryHex)

  // 第七十六锤:遮罩摘除 —— --accent-soft / --selected-bg 回归中性面板,主题色不再整面染色,
  // 只上动作件和细边/细条;第七十七锤补刀:画布雾也转中性,主题色只活在动作件上。
  // 第七十九锤(小葵拍板):自定义彻底放开 —— 色相、饱和度给满,明度不再按亮暗主题分带,
  // 亮暗同带 5~95(极深极浅都听用户的)。原来「明度安全带」保的是按钮上固定字色的可读性,
  // 现在改由 --accent-ink 承担:按派生出的主题色算对比度,深墨/白自动翻,色自由、字不糊。
  // 预设档(青碧/丁香紫)是配好的成套皮肤,里子仍走原来的配档,长相一分不变
  // (唯一例外:暗色丁香紫按钮字由深翻白,对比 3.4 → 4.8 更清楚);
  // --secondary-deep(辅助色的文字安全档)和 --line(压灰的分隔线)在两档里都保留小限位:
  // 那是派生出来的安全变体,不是用户选的颜色本身。

  if (free) {
    const dl = clamp(l, 5, 95)
    const dl2 = clamp(l2, 5, 95)
    root.setProperty('--accent', hslCss(h, s, dl))
    root.setProperty('--accent-hover', hslCss(h, s, dark ? Math.min(dl + 8, 95) : Math.max(dl - 8, 5)))
    root.setProperty('--accent-ink', pickAccentInk(h, s, dl))
    root.setProperty('--accent-soft', dark ? '#2b333a' : '#eef0f2')
    root.setProperty('--accent-line', dark ? hslCss(h, 30, 40) : hslCss(h, s, 80))
    root.setProperty('--selected-bg', dark ? '#2e3841' : '#dfe4e8')
    root.setProperty('--secondary', hslCss(h2, s2, dl2))
    root.setProperty('--secondary-deep', dark ? hslCss(h2, s2, clamp(l2, 62, 82)) : hslCss(h2, s2, clamp(l2, 26, 40)))
    root.setProperty('--line', dark ? hslCss(h2, clamp(s2, 10, 22), 27) : hslCss(h2, clamp(s2, 8, 20), 85))
    return
  }

  // 预设档:沿用 76 锤前的配档逻辑(明度带按亮暗分),保证三套皮肤和从前长得一样
  const sat = clamp(s, 30, 85)
  const sat2 = clamp(s2, 25, 80)
  if (dark) {
    const dl = clamp(l, 55, 85)
    root.setProperty('--accent', hslCss(h, sat, dl))
    root.setProperty('--accent-hover', hslCss(h, sat, Math.min(dl + 8, 88)))
    root.setProperty('--accent-ink', pickAccentInk(h, sat, dl))
    root.setProperty('--accent-soft', '#2b333a')
    root.setProperty('--accent-line', hslCss(h, 30, 40))
    root.setProperty('--selected-bg', '#2e3841')
    root.setProperty('--secondary', hslCss(h2, sat2, clamp(l2, 50, 78)))
    root.setProperty('--secondary-deep', hslCss(h2, sat2, clamp(l2, 62, 82)))
    root.setProperty('--line', hslCss(h2, clamp(s2, 10, 22), 27))
  } else {
    const dl = clamp(l, 25, 62)
    root.setProperty('--accent', hslCss(h, sat, dl))
    root.setProperty('--accent-hover', hslCss(h, sat, dl - 8))
    root.setProperty('--accent-ink', pickAccentInk(h, sat, dl))
    root.setProperty('--accent-soft', '#eef0f2')
    root.setProperty('--accent-line', hslCss(h, sat, 80))
    root.setProperty('--selected-bg', '#dfe4e8')
    root.setProperty('--secondary', hslCss(h2, sat2, clamp(l2, 45, 72)))
    root.setProperty('--secondary-deep', hslCss(h2, sat2, clamp(l2, 26, 40)))
    root.setProperty('--line', hslCss(h2, clamp(s2, 8, 20), 85))
  }
}

/** 开画之前调用:先把存档的外观定下来(免得先闪一帧错的),再盯着系统深浅色开关随时跟 */
let started = false
export function initAppearance(): void {
  if (started) return
  started = true
  applyAppearance(loadAppearance())
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const a = loadAppearance()
    if (a.mode === 'auto') applyAppearance(a)
  })
}
