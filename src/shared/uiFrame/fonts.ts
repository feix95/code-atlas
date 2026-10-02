// 字体(§11):Inter + 思源黑体(Noto Sans SC)可变字体,woff2 打包进规格包,完全离线。
// 字体面清单从 fontsource 的 index.css 解析;导出与画布用同一份清单,只是文件地址不同。
import type { FontPlan } from './types.ts'

export interface FontFace {
  family: string
  weight: string
  file: string
  format: string
  unicodeRange: string
}

export interface FontSource {
  dir: FontPlan['dir']
  /** fontsource 包的 index.css 原文 */
  css: string
}

const FACE_RE = /@font-face\s*{([^}]*)}/g

function prop(block: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block)
  return m ? m[1].trim() : null
}

/** 解析 fontsource index.css 的 @font-face(只收正体) */
export function parseFontFaces(css: string): FontFace[] {
  const out: FontFace[] = []
  for (const m of css.matchAll(FACE_RE)) {
    const block = m[1]
    if (prop(block, 'font-style') !== 'normal') continue
    const src = prop(block, 'src') ?? ''
    const file = /url\(\.\/files\/([^)]+)\)/.exec(src)?.[1]
    const format = /format\('([^']+)'\)/.exec(src)?.[1] ?? 'woff2'
    const family = prop(block, 'font-family')?.replace(/['"]/g, '')
    if (!file || !family) continue
    out.push({
      family,
      weight: prop(block, 'font-weight') ?? '400',
      file,
      format,
      unicodeRange: prop(block, 'unicode-range') ?? ''
    })
  }
  return out
}

/** 规格包要带的字体文件清单(主进程照单复制) */
export function fontPlans(sources: FontSource[]): FontPlan[] {
  return sources.map((s) => ({ dir: s.dir, files: parseFontFaces(s.css).map((f) => f.file) }))
}

/** fonts.css 正文;urlFor 决定文件地址(导出 = 相对路径,画布 = 打包后的资源地址) */
export function fontsCss(
  sources: FontSource[],
  urlFor: (dir: FontPlan['dir'], file: string) => string
): string {
  const faces = sources.flatMap((s) =>
    parseFontFaces(s.css).map(
      (f) =>
        `@font-face {\n  font-family: '${f.family}';\n  font-style: normal;\n  font-display: block;\n` +
        `  font-weight: ${f.weight};\n  src: url(${urlFor(s.dir, f.file)}) format('${f.format}');\n` +
        `  unicode-range: ${f.unicodeRange};\n}`
    )
  )
  return `/* fonts.css · Inter 与思源黑体(Noto Sans SC)可变字体,SIL OFL 1.1,文件随包附带 */\n\n${faces.join('\n\n')}\n`
}

/** 规格包内 fonts.css 用的相对地址(fonts.css 与字体目录同在 fonts/ 下) */
export const PACKAGE_FONT_URL = (dir: FontPlan['dir'], file: string): string => `./${dir}/${file}`
