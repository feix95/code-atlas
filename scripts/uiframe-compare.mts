// UI 规格包 · 页面自动比对(开发侧验收工具,§19.1 第 6 条;不进产品功能,也不是回读验收)。
// 用法:npm run uiframe:compare -- <标准页.html> <被测页.html> [--width 1280] [--height 800] [--out 报告.md]
// 两页在同一浏览器、同一视口、字体加载完成后,按 DOM 顺序逐元素量:位置、尺寸、圆角、颜色、字体。
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

/** 几何量的容差(逻辑像素) */
const GEOMETRY_TOLERANCE = 0.5

const STYLE_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'color',
  'background-color',
  'border-top-left-radius',
  'border-top-width',
  'border-top-color',
  'box-shadow',
  'opacity'
] as const

interface Measured {
  path: string
  tag: string
  x: number
  y: number
  w: number
  h: number
  style: Record<string, string>
}

function argValue(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback
}

const files = process.argv
  .slice(2)
  .filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'))
if (files.length < 2) {
  console.error(
    '用法:npm run uiframe:compare -- <标准页.html> <被测页.html> [--width 1280] [--height 800] [--out 报告.md]'
  )
  process.exit(2)
}
const width = Number(argValue('--width', '1280'))
const height = Number(argValue('--height', '800'))
const outFile = argValue('--out', '')

/** 优先用 Windows 自带的 Edge(免下载浏览器);没有再退回 Playwright 自带的 Chromium。两页始终同一浏览器量 */
async function launch(): Promise<Awaited<ReturnType<typeof chromium.launch>>> {
  try {
    return await chromium.launch({ channel: 'msedge' })
  } catch {
    return chromium.launch()
  }
}

async function measure(file: string): Promise<{ items: Measured[]; fontsOk: boolean }> {
  const browser = await launch()
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(resolve(file)).href)
    const fontsOk = await page.evaluate(async () => {
      await document.fonts.ready
      return [...document.fonts].every((f) => f.status !== 'error')
    })
    const items = await page.evaluate((props: readonly string[]) => {
      const out: Array<{
        path: string
        tag: string
        x: number
        y: number
        w: number
        h: number
        style: Record<string, string>
      }> = []
      const walk = (el: Element, path: string): void => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        const style: Record<string, string> = {}
        for (const p of props) style[p] = cs.getPropertyValue(p)
        const cls = el.getAttribute('class')
        const label = `${path}>${el.tagName.toLowerCase()}${cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''}`
        out.push({
          path: label,
          tag: el.tagName.toLowerCase(),
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          style
        })
        if (el.tagName.toLowerCase() === 'svg') return
        ;[...el.children].forEach((c, i) => walk(c, `${path}/${i}`))
      }
      walk(document.body, '')
      return out
    }, STYLE_PROPS)
    return { items, fontsOk }
  } finally {
    await browser.close()
  }
}

const [a, b] = await Promise.all([measure(files[0]), measure(files[1])])
const rows: string[] = []
const near = (x: number, y: number): boolean => Math.abs(x - y) <= GEOMETRY_TOLERANCE
const count = Math.max(a.items.length, b.items.length)
for (let i = 0; i < count; i++) {
  const x = a.items[i]
  const y = b.items[i]
  if (!x || !y) {
    rows.push(
      `| ${i} | ${(x ?? y)?.path ?? '?'} | 元素数量 | ${x ? '有' : '无'} | ${y ? '有' : '无'} |`
    )
    continue
  }
  if (x.tag !== y.tag) {
    rows.push(`| ${i} | ${x.path} | 标签 | ${x.tag} | ${y.tag} |`)
    continue
  }
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    if (!near(x[k], y[k]))
      rows.push(`| ${i} | ${x.path} | ${k} | ${x[k].toFixed(2)} | ${y[k].toFixed(2)} |`)
  }
  for (const p of STYLE_PROPS) {
    if (x.style[p] !== y.style[p])
      rows.push(`| ${i} | ${x.path} | ${p} | ${x.style[p]} | ${y.style[p]} |`)
  }
}

const report = [
  `# 页面比对报告`,
  '',
  `- 标准页:\`${files[0]}\`(${a.items.length} 个元素,字体${a.fontsOk ? '已加载' : '加载失败'})`,
  `- 被测页:\`${files[1]}\`(${b.items.length} 个元素,字体${b.fontsOk ? '已加载' : '加载失败'})`,
  `- 视口:${width} × ${height};几何容差 ${GEOMETRY_TOLERANCE} 逻辑像素`,
  `- 结论:${rows.length === 0 ? '**完全一致**' : `**${rows.length} 处差异**`}`,
  '',
  ...(rows.length
    ? ['| # | 元素 | 项目 | 标准页 | 被测页 |', '| --- | --- | --- | --- | --- |', ...rows]
    : []),
  ''
].join('\n')

console.log(report)
if (outFile) writeFileSync(outFile, report, 'utf8')
process.exit(rows.length === 0 ? 0 : 1)
