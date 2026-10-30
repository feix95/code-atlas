// journey 的停靠一段:大纲从浮窗搬进左栏(停靠钮 / 直接拖过去)、左栏里点条目跳转、
// 文件树与大纲之间那条分割线(悬停变粗蓝条、拖动分比例、双击回自适应、两块各滚各的)、
// 左栏收起时自己退回浮窗、按住标题条拖出左栏放回浮窗。结束时回到未停靠状态。
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright'
import { revealBar, waitHeadingNearTop } from './journey-outline-gesture.mts'

const FLOAT = '.doc-outline.is-open:visible'
const DOCK = '.sidebar-dock'
const SIDEBAR_TOGGLE = '.tb-collapse .tb-btn'

async function box(loc: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await loc.boundingBox()
  assert.ok(b, 'element must have a box')
  return b
}

/** 按住左栏大纲的标题条拖出左栏:跨过分界线先露出小牌,松手放回浮窗 */
async function dragOutOfSidebar(
  page: Page,
  sidebar: { x: number; y: number; width: number; height: number }
): Promise<void> {
  const at = await box(page.locator(`${DOCK} .sidebar-dock-head`))
  const from = { x: at.x + at.width / 2, y: at.y + at.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 30, from.y, { steps: 3 })
  assert.equal(
    await page.locator('.sidebar-dock-ghost').count(),
    0,
    'still inside the sidebar: no floating pill'
  )
  await page.mouse.move(sidebar.x + sidebar.width + 240, from.y + 30, { steps: 8 })
  await page.locator('.sidebar-dock-ghost').waitFor()
  await page.mouse.up()
  await page.locator(FLOAT).waitFor()
  assert.equal(await page.locator(DOCK).count(), 0, 'drag out of the sidebar brings the float back')
}

/** 按住浮窗抓手拖到左栏上方:半路不亮,进了左栏亮落位框、浮窗淡下去,松手就停靠 */
async function dragIntoDock(
  page: Page,
  sidebar: { x: number; y: number; width: number; height: number }
): Promise<void> {
  const outline = page.locator(FLOAT)
  await revealBar(page, outline)
  const grip = await box(outline.locator('.doc-outline-grip'))
  const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x - 40, from.y + 40, { steps: 3 })
  assert.equal(
    await page.locator('.sidebar.is-dock-target').count(),
    0,
    'not over the sidebar yet: no drop ring'
  )
  await page.mouse.move(sidebar.x + sidebar.width / 2, sidebar.y + sidebar.height / 2, {
    steps: 10
  })
  await page.locator('.sidebar.is-dock-target').waitFor()
  assert.equal(
    await outline.evaluate((el) => el.classList.contains('is-dock-ready')),
    true,
    'floating panel dims while over the dock'
  )
  await page.mouse.up()
  await page.locator(`${DOCK} .doc-outline-item`).first().waitFor()
  assert.equal(await page.locator(FLOAT).count(), 0, 'drop docks the outline')
}

/** 等分割线的粗度落进 want 附近(平时 1px,悬停/拖动 4px) */
async function waitLine(sash: Locator, want: number): Promise<void> {
  await sash.evaluate(
    (el, target) =>
      new Promise<void>((resolve, reject) => {
        const until = performance.now() + 2000
        const tick = (): void => {
          const h = parseFloat(getComputedStyle(el, '::after').height)
          if (Math.abs(h - target) <= 0.6) resolve()
          else if (performance.now() > until) reject(new Error(`divider stuck at ${h}px`))
          else requestAnimationFrame(tick)
        }
        tick()
      }),
    want
  )
}

/** 按住分割线中线拖 dy:正向 = 往下(大纲变矮) */
async function dragSash(page: Page, dy: number): Promise<void> {
  const at = await box(page.locator('.sidebar-dock-sash'))
  const x = at.x + at.width / 2
  const y = at.y + at.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + dy, { steps: 8 })
  await page.mouse.up()
}

/**
 * 文件树与大纲之间只有一条分割线:平时一根细线,悬停/拖动时 4px 粗蓝条;
 * 拖它分配上下比例并落盘,双击回内容自适应;两块各滚各的。
 * 结束时高度已回到自适应。
 */
async function checkDockSplitter(page: Page): Promise<void> {
  const sash = page.locator('.sidebar-dock-sash')
  const panel = page.locator(DOCK)
  assert.equal(await sash.count(), 1, 'docked: exactly one divider between tree and outline')
  await page.mouse.move(1, 1)
  await waitLine(sash, 1)
  const auto = await box(panel)
  await sash.hover()
  await waitLine(sash, 4)
  // 往上拖 60:大纲变高,比例落盘,文件树让出空间但仍然在
  await dragSash(page, -60)
  const taller = await box(panel)
  assert.ok(Math.abs(taller.height - (auto.height + 60)) <= 4, 'drag up grows the outline')
  assert.ok(taller.y < auto.y - 40, 'the outline grows upward from the divider')
  const ratio = await page.evaluate(() =>
    Number(localStorage.getItem('atlas.docOutlineDockRatio') ?? 0)
  )
  assert.ok(ratio > 0 && ratio < 1, 'split ratio saved')
  // 往下拖过头:压在大纲最小高上,文件树不会被挤没
  await dragSash(page, 600)
  const squeezed = await box(panel)
  assert.ok(squeezed.height >= 95, 'outline stops at its minimum height')
  const tree = await box(page.locator('.tree-scroll'))
  assert.ok(tree.height >= 95, 'the file tree keeps its own area')
  // 两块各滚各的:滚大纲列表,文件树不动
  const scroll = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.sidebar-outline-list')
    const treeEl = document.querySelector<HTMLElement>('.tree-scroll')
    if (!list || !treeEl) return null
    const treeTop = treeEl.scrollTop
    const first = list.firstElementChild?.getBoundingClientRect().top ?? 0
    list.scrollTop = 40
    const after = list.firstElementChild?.getBoundingClientRect().top ?? 0
    return { listMoved: after < first - 1, treeMoved: treeEl.scrollTop !== treeTop }
  })
  assert.ok(scroll?.listMoved, 'the outline list scrolls on its own')
  assert.equal(scroll?.treeMoved, false, 'scrolling the outline leaves the tree where it was')
  // 双击分割线:回到内容自适应,记下的比例清掉
  await sash.dblclick()
  await page.waitForFunction(
    () => Number(localStorage.getItem('atlas.docOutlineDockRatio') ?? 0) === 0
  )
  const reset = await box(panel)
  assert.ok(Math.abs(reset.height - auto.height) <= 4, 'dblclick returns to the content height')
}

export async function checkOutlineDock(
  page: Page,
  shot: (name: string) => Promise<unknown>,
  sections: string[]
): Promise<void> {
  const outline = page.locator(FLOAT)
  const sidebar = page.locator('.sidebar')
  const docked = page.locator(DOCK)
  const sidebarBox = await box(sidebar)

  // 1) 拖动条上的停靠钮:一点就常驻左栏,浮窗退场,条目原样搬过来
  await revealBar(page, outline)
  await outline.locator('.doc-outline-dockbtn').click()
  await docked.locator('.doc-outline-item').first().waitFor()
  assert.equal(await outline.count(), 0, 'docked: floating outline is gone')
  const items = docked.locator('.doc-outline-item')
  assert.equal(await items.count(), 1 + sections.length * 2, 'dock lists the same headings')

  // 2) 左栏里点条目照样跳,当前节高亮跟着走
  await items.filter({ hasText: 'Section Gamma' }).click()
  await waitHeadingNearTop(page, 'Section Gamma')
  await docked.locator('.doc-outline-item.is-active').filter({ hasText: 'Section Gamma' }).waitFor()
  await shot('md-outline-docked')

  // 3) 分割线:悬停变粗、拖动分比例、双击回自适应
  await checkDockSplitter(page)

  // 4) 左栏收起:左栏看不见了,大纲自己退回浮窗;展开又回去
  await page.locator(SIDEBAR_TOGGLE).click()
  await outline.waitFor()
  assert.equal(await page.locator(DOCK).count(), 0, 'collapsed sidebar: outline floats again')
  await page.locator(SIDEBAR_TOGGLE).click()
  await docked.locator('.doc-outline-item').first().waitFor()
  assert.equal(await outline.count(), 0, 'expanded sidebar: docked again')

  // 5) 按住标题条拖出左栏 = 放回浮窗
  await dragOutOfSidebar(page, sidebarBox)

  // 6) 直接把抓手拖到左栏上方松手 = 停靠;最后用放回钮回到浮窗,不把停靠态留给后面的检查
  await dragIntoDock(page, sidebarBox)
  await docked.locator('.sidebar-dock-undock').click()
  await page.locator(FLOAT).waitFor()
  assert.equal(await page.locator(DOCK).count(), 0, 'undock button returns the float')
  assert.equal(
    await page.evaluate(() => localStorage.getItem('atlas.docOutlineDocked')),
    'off',
    'undocking clears the dock preference'
  )
}
