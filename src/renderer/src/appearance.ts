// 外观系统:亮暗模式 + 配色预设 + 自定义主题色/辅助色。
// 偏好存 localStorage(界面的事,每台机器自己一套,不进 AI 配置文件)。
// 生效方式:模式往 <html> 上挂 data-theme 切换样式表里的两套 token;
// 自定义色在启动时算出一族同色系的 token 写到 :root 内联样式上,压过样式表默认值。

export type AppearanceMode = 'auto' | 'light' | 'dark'
export type AppearancePreset = 'default' | 'teal' | 'violet'

export interface Appearance {
  mode: AppearanceMode
  preset: AppearancePreset
  /** 自定义主题色(#rrggbb);不设就跟预设走 */
  accent: string | null
  /** 自定义辅助色(#rrggbb);不设就跟预设走 */
  secondary: string | null
}

export const APPEARANCE_KEY = 'atlas.appearance'

/** 配色预设:晴空蓝 = 现在的默认皮肤(不写任何内联,和从前一模一样);另两套是现成的成套配色 */
export const COLOR_PRESETS: Array<{ key: AppearancePreset; name: string; accent: string; secondary: string }> = [
  { key: 'default', name: '晴空蓝', accent: '#147dcc', secondary: '#5ac5db' },
  { key: 'teal', name: '青碧', accent: '#0e9488', secondary: '#56c3ad' },
  { key: 'violet', name: '丁香紫', accent: '#7c5cd6', secondary: '#b79ef0' }
]

/** 由主题色派生的整族 token:派生时一次性全换,保持互相搭配 */
const TOKEN_KEYS = ['--accent', '--accent-hover', '--accent-soft', '--accent-line', '--selected-bg', '--secondary'] as const

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Appearance>
      return {
        mode: p.mode === 'light' || p.mode === 'dark' ? p.mode : 'auto',
        preset: p.preset === 'teal' || p.preset === 'violet' ? p.preset : 'default',
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

/** #rgb / #rrggbb → HSL(h∈[0,360), s/l∈[0,100]) */
function hexToHsl(hex: string): [number, number, number] {
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
  const preset = COLOR_PRESETS.find((p) => p.key === a.preset) ?? COLOR_PRESETS[0]
  const [h, s, l] = hexToHsl(a.accent ?? preset.accent)
  const [h2, s2, l2] = hexToHsl(a.secondary ?? preset.secondary)
  const sat = clamp(s, 30, 85)
  const sat2 = clamp(s2, 25, 80)

  // 明度做安全限位:再深的主题色也不至于在暗背景上看不见,再亮的也不至于糊成一片
  if (dark) {
    const dl = clamp(l, 62, 80)
    root.setProperty('--accent', hslCss(h, sat, dl))
    root.setProperty('--accent-hover', hslCss(h, sat, Math.min(dl + 12, 88)))
    root.setProperty('--accent-soft', hslCss(h, 35, 24))
    root.setProperty('--accent-line', hslCss(h, 30, 40))
    root.setProperty('--selected-bg', hslCss(h, 40, 24))
    root.setProperty('--secondary', hslCss(h2, sat2, clamp(l2, 50, 78)))
  } else {
    root.setProperty('--accent', hslCss(h, sat, clamp(l, 28, 58)))
    root.setProperty('--accent-hover', hslCss(h, sat, clamp(l, 28, 58) - 8))
    root.setProperty('--accent-soft', hslCss(h, sat, 94))
    root.setProperty('--accent-line', hslCss(h, sat, 80))
    root.setProperty('--selected-bg', hslCss(h, sat, 91))
    root.setProperty('--secondary', hslCss(h2, sat2, clamp(l2, 45, 72)))
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
