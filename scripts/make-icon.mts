// 应用图标生成管线:build/icons-src/ 的 SVG 源 → 多尺寸 PNG → build/icon.ico
// 跑法:node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/make-icon.mts
// 换图标方案:改下面 VARIANT 重跑;预览图落 dist/icon-preview/(gitignore 挡住,本地看效果用)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const VARIANT = 'you-are-here'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'build', 'icons-src')
const OUT_PREVIEW = join(ROOT, 'dist', 'icon-preview')

function renderPng(svgFile: string, size: number): Buffer {
  const svg = readFileSync(join(SRC, svgFile), 'utf8')
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng())
}

// 16-48px 走加粗简化版(小尺寸砍细节才糊不了),64-256px 走标准版
const SMALL_SIZES = [16, 24, 32, 48]
const BIG_SIZES = [64, 128, 256]

const ico = await pngToIco([
  ...SMALL_SIZES.map((s) => renderPng(`${VARIANT}-small.svg`, s)),
  ...BIG_SIZES.map((s) => renderPng(`${VARIANT}.svg`, s)),
])
writeFileSync(join(ROOT, 'build', 'icon.ico'), ico)

// 预览:两个方案各出 1024 大图 + 48px 实际尺寸图,给小葵对比挑
mkdirSync(OUT_PREVIEW, { recursive: true })
for (const v of ['you-are-here', 'constellation']) {
  writeFileSync(join(OUT_PREVIEW, `${v}-1024.png`), renderPng(`${v}.svg`, 1024))
  writeFileSync(join(OUT_PREVIEW, `${v}-48.png`), renderPng(`${v}-small.svg`, 48))
}
console.log(`build/icon.ico 已生成(方案:${VARIANT},尺寸 ${[...SMALL_SIZES, ...BIG_SIZES].join('/')}),预览图在 dist/icon-preview/`)
