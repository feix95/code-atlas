// journey 的大纲一段(拆出来免得主脚本再长):真 Electron 里验 md 阅读档与 Word 预览共用的大纲浮窗。
// 样本在扫描前由 writeOutlineFixtures 落盘;checkDocOutline 在工作区已打开后跑。
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { buildDocx, docxXml } from './docx-fixture.mts'
import { checkCircleDrag, revealBar } from './journey-outline-gesture.mts'
import { checkOutlinePlacement } from './journey-outline-placement.mts'

const FILLER = 'Lorem ipsum dolor sit amet, reading line filler text. '.repeat(12)
const MD_SECTIONS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Omega and its closing notes']

export async function writeOutlineFixtures(project: string): Promise<void> {
  const md = ['# Outline sample', '', FILLER, '']
  for (const name of MD_SECTIONS) {
    md.push(`## Section ${name}`, '', ...Array.from({ length: 6 }, () => `${FILLER}\n`))
    md.push(`### Detail ${name}`, '', FILLER, '')
  }
  await writeFile(join(project, 'outline.md'), md.join('\n'))
  await writeFile(
    join(project, 'plain.docx'),
    buildDocx({ body: [docxXml.para('No headings here'), docxXml.para(FILLER)] })
  )
}

/** 条目字号与文件树文件名同档(--font-ml),每级缩进与文件树同 token(--tree-indent) */
async function checkItemType(outline: Locator): Promise<void> {
  const type = await outline.evaluate((el) => {
    const root = getComputedStyle(document.documentElement)
    const rem = parseFloat(root.fontSize)
    const indent = parseFloat(root.getPropertyValue('--tree-indent')) * rem
    const font = parseFloat(root.getPropertyValue('--font-ml')) * rem
    const pads = [...el.querySelectorAll<HTMLElement>('.doc-outline-item')].map((item) => ({
      depth: Number(item.style.getPropertyValue('--outline-depth')),
      pad: parseFloat(getComputedStyle(item).paddingLeft),
      size: parseFloat(getComputedStyle(item).fontSize)
    }))
    const top = pads.find((p) => p.depth === 0)
    const next = pads.find((p) => p.depth === 1)
    return { indent, font, step: next && top ? next.pad - top.pad : NaN, size: top?.size ?? 0 }
  })
  assert.ok(
    Math.abs(type.step - type.indent) < 0.5,
    `indent per level must equal --tree-indent (${type.step} vs ${type.indent})`
  )
  assert.ok(
    Math.abs(type.size - type.font) < 0.5,
    `item font must be --font-ml (${type.size} vs ${type.font})`
  )
}

async function openFile(page: Page, name: string): Promise<void> {
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: name }).click()
}

/** 当前可见那扇阅读栏里,某个标题离栏顶多远(px);找不到回 null(保活的隐藏签不算) */
async function headingOffset(page: Page, text: string): Promise<number | null> {
  return page.evaluate((wanted) => {
    const view = [...document.querySelectorAll('.code-view.is-reading')].find(
      (el) => el.getClientRects().length > 0
    )
    const head = [...(view?.querySelectorAll('.md-h') ?? [])].find(
      (el) => el.textContent?.trim() === wanted
    )
    if (!view || !head) return null
    return head.getBoundingClientRect().top - view.getBoundingClientRect().top
  }, text)
}

async function waitHeadingNearTop(page: Page, text: string): Promise<void> {
  for (let tries = 0; tries < 60; tries++) {
    const gap = await headingOffset(page, text)
    if (gap !== null && gap >= 0 && gap < 80) return
    await page.waitForTimeout(50)
  }
  assert.fail(`clicking the outline must scroll "${text}" to the top of the preview`)
}

async function checkMdOutline(page: Page, shot: (name: string) => Promise<unknown>): Promise<void> {
  await openFile(page, 'outline.md')
  const lock = page.locator('.code-pane-head:visible .code-mode-btn')
  await lock.waitFor()
  // 阅读档 = 排版显示 + 只读:先锁上,收尾再解开,不把全局偏好留给后面
  if ((await lock.getAttribute('aria-pressed')) !== 'true') await lock.click()
  const view = page.locator('.code-view.is-reading:visible')
  // 浮窗挂在预览面板上(阅读栏的兄弟),不在 view 里
  const outline = page.locator('.doc-outline:visible')
  const items = outline.locator('.doc-outline-item')
  await items.first().waitFor()
  assert.equal(await items.count(), 1 + MD_SECTIONS.length * 2, 'md outline lists h1..h3')
  const article = view.locator('.code-reading')
  const openBox = await article.boundingBox()
  const toggle = outline.locator('.doc-outline-toggle')
  // 收起钮在悬停拖动条上:先到上缘热区把它叫出来
  await revealBar(page, outline)
  await toggle.click()
  assert.equal(await outline.locator('.doc-outline-list').count(), 0, 'toggle collapses outline')
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  const knob = await toggle.boundingBox()
  assert.ok(knob, 'collapsed toggle must have a box')
  assert.ok(Math.abs(knob.width - knob.height) < 0.5, 'collapsed toggle is square-sized')
  const rem = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).fontSize)
  )
  assert.ok(Math.abs(knob.width - 2.5 * rem) < 1, 'collapsed toggle is a 2.5rem circle')
  assert.equal(
    await toggle.evaluate((el) => getComputedStyle(el).borderRadius),
    '50%',
    'collapsed toggle is a circle'
  )
  const closedBox = await article.boundingBox()
  assert.ok(openBox && closedBox, 'reading column must have a box')
  assert.equal(openBox.width, closedBox.width, 'outline must not take reading-column width')
  assert.equal(openBox.x, closedBox.x, 'outline must not shift the reading column')
  await checkCircleDrag(page, toggle)
  await items.first().waitFor()
  await checkItemType(outline)
  const panelTop = (await outline.boundingBox())?.y
  await items.filter({ hasText: 'Section Delta' }).click()
  await waitHeadingNearTop(page, 'Section Delta')
  await outline
    .locator('.doc-outline-item.is-active')
    .filter({ hasText: 'Section Delta' })
    .waitFor()
  const pinnedTop = (await outline.boundingBox())?.y
  assert.ok(panelTop !== undefined && pinnedTop !== undefined)
  assert.ok(Math.abs(panelTop - pinnedTop) < 2, 'outline stays pinned while the body scrolls')
  await shot('md-outline')
  await items.filter({ hasText: 'Section Beta' }).focus()
  await page.keyboard.press('Enter')
  await waitHeadingNearTop(page, 'Section Beta')
  assert.ok(
    ((await headingOffset(page, 'Section Delta')) ?? 0) > 80,
    'Enter jumps to the focused item'
  )
  await checkOutlinePlacement(page)
  await lock.click()
}

async function checkDocxOutline(page: Page): Promise<void> {
  await openFile(page, 'report.docx')
  const outline = page.locator('.doc-outline:visible')
  await outline.locator('.doc-outline-item').filter({ hasText: 'Quarterly plan' }).waitFor()
  await openFile(page, 'plain.docx')
  await page.locator('.docx-body:visible').filter({ hasText: 'No headings here' }).waitFor()
  assert.equal(
    await page.locator('.doc-outline:visible').count(),
    0,
    'no headings -> no outline panel'
  )
}

export async function checkDocOutline(
  page: Page,
  shot: (name: string) => Promise<unknown>
): Promise<void> {
  await checkDocxOutline(page)
  await checkMdOutline(page, shot)
}
