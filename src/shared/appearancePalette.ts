// 灰阶皮肤真值表(P1-2):「石墨」这套中性色的唯一户口 ——
// main.css 的 :root 静态值(首帧兜底)、appearance.ts 的 achro 回落、
// COLOR_PRESETS 的种子色,三处共查这一本,调灰阶只改这里。
// 改这里时记得同步 main.css 的 :root 写真值(那边有注释指路回本文件)。

export const NEUTRAL_PALETTE = {
  light: {
    window: '#f6f6f6',
    canvasTint: '#ffffff',
    surface: '#ffffff',
    surfaceSoft: '#f6f6f6',
    line: '#d0d0d0',
    lineSoft: '#d0d0d0',
    accentBright: '#000000',
    accentLine: '#d9d9d9',
    accentSoft: 'rgba(0,0,0,0.06)',
    selectedBg: 'rgba(0,0,0,0.08)'
  },
  dark: {
    window: '#282828',
    canvasTint: '#1c1c1c',
    surface: '#282828',
    surfaceSoft: '#232323',
    line: '#3c3c3c',
    lineSoft: '#3c3c3c',
    accentBright: '#f0f0f0',
    accentLine: '#555555',
    accentSoft: 'rgba(255,255,255,0.08)',
    selectedBg: 'rgba(255,255,255,0.13)'
  },
  /** 石墨预设的种子色 = 暗色样式表的 accent/secondary 真值:
   *  进自定义档时种子是它俩,保证「自定义默认」和「石墨」像素级一致 */
  seed: { accent: '#484848', secondary: '#999999' }
} as const

/** 按当前主题取灰阶档 */
export function neutralFor(dark: boolean) {
  return dark ? NEUTRAL_PALETTE.dark : NEUTRAL_PALETTE.light
}

/** #rgb / #rrggbb → HSL(h∈[0,360), s/l∈[0,100]);纯函数,渲染层和主进程共用同一套色算 */
export function hexToHsl(hex: string): [number, number, number] {
  let m = hex.replace('#', '')
  if (m.length === 3)
    m = m
      .split('')
      .map((c) => c + c)
      .join('')
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

/** HSL → css 颜色串;渲染层往 :root 写 token、主进程往窗口底色写,同一个出口 */
export function hslCss(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`
}
