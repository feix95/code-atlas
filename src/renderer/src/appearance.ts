// 外观系统:亮暗模式 + 配色预设 + 自定义主题色/辅助色。
// 偏好存主进程的 appearance.json(2026-09-16 起从 localStorage 搬家 —— 那份按端口分仓、
// 端口一挤就出厂设置的存档方式退役;首启自动把 localStorage 旧档收编进新家)。
// 生效方式:模式往 <html> 上挂 data-theme 切换样式表里的两套 token;
// 自定义色在启动时算出一族同色系的 token 写到 :root 内联样式上,压过样式表默认值。

import {
  type Appearance,
  type AppearanceMode,
  type AppearancePreset,
  COLOR_PRESETS,
  resolveAppearanceStartup,
  sanitizeAppearance
} from '../../shared/appearancePrefs.ts'

// 类型与预设表对外照旧从这里出(既有 import 不用动),本体住在 shared
export type { Appearance, AppearanceMode, AppearancePreset }
export { COLOR_PRESETS }

export const APPEARANCE_KEY = 'atlas.appearance'

/** 当前生效的外观(内存账):首次从主进程文件/旧档迁移定值,之后 saveAppearance 实时更新 */
let current: Appearance | null = null

function readLegacyRaw(): string | null {
  try {
    return localStorage.getItem(APPEARANCE_KEY)
  } catch {
    return null
  }
}

export function loadAppearance(): Appearance {
  if (current) return current
  // 首次定值:主进程存档为准;主进程没存过而 localStorage 有旧档 → 收编迁移。
  // getSync 是同步通道,页面脚本跑之前就定好外观,首帧不闪默认皮。
  const startup = resolveAppearanceStartup({
    stored: window.atlas.appearance.getSync(),
    legacyRaw: readLegacyRaw()
  })
  current = startup.value
  if (startup.migrate) {
    // 旧档迁新家:异步落盘不阻塞首帧;迁完把旧仓清掉,从此不再回头
    void window.atlas.appearance.save(current)
    try {
      localStorage.removeItem(APPEARANCE_KEY)
    } catch {
      // 清不掉也不碍事:主进程存档已经在了,下次启动走「stored 在」分支
    }
  }
  return current
}

export function saveAppearance(a: Appearance): void {
  // 先清清洗:界面层理论上只会送合法值,这道闸保证存档永远干净
  current = sanitizeAppearance(a)
  // 落盘是异步的,调用方(点「应用更改」)不等它:存档本身已经是内存这份,写文件失败也没界面可回滚
  void window.atlas.appearance.save(current)
}

/** 由主题色派生的整族 token:派生时一次性全换,保持互相搭配
 *  (--secondary-deep 是辅助色的文字安全档;--line 边框线归辅助色管;
 *   底板一族 --window/--canvas-tint/--surface/--surface-soft/--line-soft 只被「彩色预设档」染色 ——
 *   自定义档和无色组合不动它们,画布照旧中性) */
const TOKEN_KEYS = [
  '--accent',
  '--accent-bright',
  '--accent-hover',
  '--accent-ink',
  '--accent-soft',
  '--accent-line',
  '--selected-bg',
  '--secondary',
  '--secondary-deep',
  '--line',
  '--window',
  '--canvas-tint',
  '--surface',
  '--surface-soft',
  '--line-soft'
] as const

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

/** 底板一族染色(雾空蓝和自定义底板色共用同一套结构):
 *  色相/饱和度听来源色,明度永远跟主题的灰阶档走 —— 黑夜深、白天亮自动翻,
 *  这就是「怎么调都好看」的机关;来源色近灰(s<8)时直接回落石墨中性底 */
function paintSurfaces(root: CSSStyleDeclaration, dark: boolean, h: number, s: number): void {
  const achro = s < 8
  if (dark) {
    // 分寸(小葵拍板):只留一丝色调 —— 饱和度封顶 12~15、明度比石墨灰再压一档
    const surfSat = Math.min(s * 0.28, 12)
    root.setProperty('--window', achro ? '#282828' : hslCss(h, surfSat, 14))
    root.setProperty('--canvas-tint', achro ? '#1c1c1c' : hslCss(h, Math.min(s * 0.35, 15), 9))
    root.setProperty('--surface', achro ? '#282828' : hslCss(h, surfSat, 14))
    root.setProperty('--surface-soft', achro ? '#232323' : hslCss(h, surfSat, 12))
    root.setProperty('--line-soft', achro ? '#2e2e2e' : hslCss(h, Math.min(s, 14), 16))
  } else {
    const surfSat = Math.min(s * 0.4, 18)
    root.setProperty('--window', achro ? '#f6f6f6' : hslCss(h, surfSat, 96))
    root.setProperty('--canvas-tint', achro ? '#ffffff' : hslCss(h, surfSat, 99))
    root.setProperty('--surface', achro ? '#ffffff' : hslCss(h, surfSat, 99))
    root.setProperty('--surface-soft', achro ? '#f6f6f6' : hslCss(h, surfSat, 96))
    root.setProperty('--line-soft', achro ? '#ededed' : hslCss(h, Math.min(s, 16), 92))
  }
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
  // 预设档(石墨 + 手动叠了自定义色的组合)仍走配档逻辑,长相一分不变;
  // --secondary-deep(辅助色的文字安全档)和 --line(压灰的分隔线)在两档里都保留小限位:
  // 那是派生出来的安全变体,不是用户选的颜色本身。
  // 无彩色判据同自定义档:近灰时结构线/亮字回落样式表纯灰,不派生

  if (free) {
    const dl = clamp(l, 5, 95)
    const dl2 = clamp(l2, 5, 95)
    // 无彩色判据(无色皮修):accent 选了纯灰/近灰时,结构线、亮字直接对齐样式表那套纯灰常数 ——
    // 不派生,不然「自定义带石墨色」会整皮亮一档;彩色 accent 照旧派生
    const achro = s < 8
    const achro2 = s2 < 8
    root.setProperty('--accent', hslCss(h, s, dl))
    root.setProperty(
      '--accent-bright',
      achro ? (dark ? '#f0f0f0' : '#000000') : dark ? hslCss(h, s, Math.min(dl + 18, 95)) : hslCss(h, s, Math.max(dl - 10, 8))
    )
    root.setProperty('--accent-hover', hslCss(h, s, dark ? Math.min(dl + 8, 95) : Math.max(dl - 8, 5)))
    root.setProperty('--accent-ink', pickAccentInk(h, s, dl))
    root.setProperty('--accent-soft', dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)')
    root.setProperty('--accent-line', achro ? (dark ? '#555555' : '#d9d9d9') : dark ? hslCss(h, Math.min(s, 30), 40) : hslCss(h, s, 80))
    root.setProperty('--selected-bg', dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.08)')
    root.setProperty('--secondary', hslCss(h2, s2, dl2))
    root.setProperty('--secondary-deep', dark ? hslCss(h2, s2, clamp(l2, 62, 82)) : hslCss(h2, s2, clamp(l2, 26, 40)))
    root.setProperty('--line', achro2 ? (dark ? '#333333' : '#e4e4e4') : dark ? hslCss(h2, Math.min(s2, 22), 27) : hslCss(h2, Math.min(s2, 20), 85))
    // 底板色(自定义第三色):跟雾空蓝同一套机关 —— 只取它的色相/饱和度当染色方向,
    // 明度永远跟着白天/黑夜的灰阶档自动翻,不存在「黑夜选的色白天翻车」。
    // 没选就 s=0 走无彩色分支,显性写回石墨中性底,顺便顶掉上一身彩色预设皮的染色
    const [h3, s3] = a.base ? hexToHsl(a.base) : [0, 0]
    paintSurfaces(root, dark, h3, s3)
    return
  }

  // 预设档:沿用 76 锤前的配档逻辑(明度带按亮暗分),保证三套皮肤和从前长得一样
  const sat = clamp(s, 30, 85)
  const sat2 = clamp(s2, 25, 80)
  const achro = s < 8
  const achro2 = s2 < 8
  if (dark) {
    const dl = clamp(l, 55, 85)
    root.setProperty('--accent', hslCss(h, sat, dl))
    root.setProperty('--accent-bright', achro ? '#f0f0f0' : hslCss(h, sat, Math.min(dl + 18, 95)))
    root.setProperty('--accent-hover', hslCss(h, sat, Math.min(dl + 8, 88)))
    root.setProperty('--accent-ink', pickAccentInk(h, sat, dl))
    // 彩色预设连底板一起泛色(雾空蓝回归老皮):画布/框架/面板/软线往辅助色的色相里带,
    // 选中底和柔底回归 accent 的半透明染色;无彩色组合照旧全套中性
    root.setProperty('--accent-soft', achro ? 'rgba(255,255,255,0.08)' : `hsl(${Math.round(h)} ${Math.round(sat)}% ${Math.round(dl)}% / 0.14)`)
    root.setProperty('--accent-line', achro ? '#555555' : hslCss(h, Math.min(sat, 30), 40))
    root.setProperty('--selected-bg', achro ? 'rgba(255,255,255,0.13)' : `hsl(${Math.round(h)} ${Math.round(sat)}% ${Math.round(dl)}% / 0.20)`)
    root.setProperty('--secondary', hslCss(h2, sat2, clamp(l2, 50, 78)))
    root.setProperty('--secondary-deep', hslCss(h2, sat2, clamp(l2, 62, 82)))
    root.setProperty('--line', achro2 ? '#333333' : hslCss(h2, Math.min(s2, 16), 25))
    paintSurfaces(root, dark, h2, s2)
  } else {
    const dl = clamp(l, 25, 62)
    root.setProperty('--accent', hslCss(h, sat, dl))
    root.setProperty('--accent-bright', achro ? '#000000' : hslCss(h, sat, Math.max(dl - 10, 8)))
    root.setProperty('--accent-hover', hslCss(h, sat, dl - 8))
    root.setProperty('--accent-ink', pickAccentInk(h, sat, dl))
    root.setProperty('--accent-soft', achro ? 'rgba(0,0,0,0.06)' : `hsl(${Math.round(h)} ${Math.round(sat)}% ${Math.round(dl)}% / 0.10)`)
    root.setProperty('--accent-line', achro ? '#d9d9d9' : hslCss(h, sat, 80))
    root.setProperty('--selected-bg', achro ? 'rgba(0,0,0,0.08)' : `hsl(${Math.round(h)} ${Math.round(sat)}% ${Math.round(dl)}% / 0.12)`)
    root.setProperty('--secondary', hslCss(h2, sat2, clamp(l2, 45, 72)))
    root.setProperty('--secondary-deep', hslCss(h2, sat2, clamp(l2, 26, 40)))
    root.setProperty('--line', achro2 ? '#e4e4e4' : hslCss(h2, Math.min(s2, 20), 85))
    paintSurfaces(root, dark, h2, s2)
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
