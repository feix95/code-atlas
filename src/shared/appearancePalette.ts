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
