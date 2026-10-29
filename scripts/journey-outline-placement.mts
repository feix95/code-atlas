// journey 的大纲浮窗摆放一段:半透明底、平时紧包列表、悬停才在上缘之上长出拖动条、宽度紧包内容(出滚动条也不截字)、不出悬停提示、
// 拉手斜纹常显悬停调亮、抓手拖动与夹边(上缘能压到页头之上)、右下角拉伸、
// 拉大途中跟手、松手宽高吸回内容尺寸,拉小保留,换短标题的文档收到内容尺寸,
// 位置落盘后换签照样生效、双击拉手回到自适应。调用前 outline.md 已在阅读档里开着大纲。
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright'
import { checkOutlineGestures, revealBar, waitBar } from './journey-outline-gesture.mts'

type Rect = { x: number; y: number; width: number; height: number }
type PaneRect = { left: number; top: number; right: number; bottom: number }

const VIEW = '.code-view.is-reading:visible'
/** 大纲浮窗挂在预览面板上(阅读栏的兄弟),按可见认当前那扇 */
const PANEL = '.doc-outline.is-open:visible'

async function rectOf(loc: Locator): Promise<Rect> {
  const box = await loc.boundingBox()
  assert.ok(box, 'element must have a box')
  return box
}

/** 当前阅读栏所在的预览面板:浮窗的活动范围以面板为界(上缘能压到页头之上) */
async function paneOf(page: Page): Promise<PaneRect> {
  return page.locator(VIEW).evaluate((el) => {
    const pane = el.closest('.code-pane') ?? el
    const r = pane.getBoundingClientRect()
    const left = r.left + pane.clientLeft
    const top = r.top + pane.clientTop
    return { left, top, right: left + pane.clientWidth, bottom: top + pane.clientHeight }
  })
}

/** 阅读栏的顶(面板顶 + 页头高):浮窗能拖到它上面,就是压住了页头 */
async function viewTopOf(page: Page): Promise<number> {
  return page.locator(VIEW).evaluate((el) => el.getBoundingClientRect().top)
}

/** 按住某个把手的中心拖到 (x, y) 屏幕坐标 */
async function dragTo(page: Page, handle: Locator, x: number, y: number): Promise<void> {
  // 拖动条平时隐身:按抓手前先在上缘热区把它叫出来;拉手常显,不用叫
  const isGrip = await handle.evaluate((el) => el.classList.contains('doc-outline-grip'))
  if (isGrip) await revealBar(page, handle.locator('xpath=ancestor::nav[1]'))
  const h = await rectOf(handle)
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 6 })
  await page.mouse.up()
}

async function dragBy(page: Page, handle: Locator, dx: number, dy: number): Promise<void> {
  const h = await rectOf(handle)
  await dragTo(page, handle, h.x + h.width / 2 + dx, h.y + h.height / 2 + dy)
}

const near = (a: number, b: number, tol = 2): boolean => Math.abs(a - b) <= tol

async function checkLook(panel: Locator): Promise<void> {
  const alpha = await panel.evaluate((el) => {
    const color = getComputedStyle(el).backgroundColor
    const hit = /\/\s*([\d.]+)\s*\)$/.exec(color) ?? /rgba\([^)]*,\s*([\d.]+)\)$/.exec(color)
    return hit ? Number(hit[1]) : 1
  })
  assert.ok(alpha < 1, 'outline background must be see-through')
  await checkHugs(panel)
}

/** 宽度紧包最长条目(列表宽减去最长条目所需不到 4px,或已在最小宽),且条目离左右边框一样远 */
async function checkHugs(panel: Locator): Promise<void> {
  const fit = await panel.evaluate((el) => {
    let need = 0
    for (const item of el.querySelectorAll('.doc-outline-item')) {
      const range = document.createRange()
      range.selectNodeContents(item)
      const css = getComputedStyle(item)
      const pad = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight)
      need = Math.max(need, range.getBoundingClientRect().width + pad)
    }
    const list = el.querySelector('.doc-outline-list')
    const item = el.querySelector<HTMLElement>('.doc-outline-item')
    const p = el.getBoundingClientRect()
    const r = item?.getBoundingClientRect()
    const border = parseFloat(getComputedStyle(el).borderLeftWidth)
    return {
      width: list?.clientWidth ?? 0,
      need,
      min: parseFloat(getComputedStyle(el).minWidth),
      leftGap: r ? r.left - (p.left + border) : Number.NaN,
      rightGap: r ? p.right - border - r.right : Number.NaN
    }
  })
  assert.ok(
    fit.width - fit.need < 4 || fit.width <= fit.min,
    `outline width must hug the longest item (list ${fit.width}px, needs ${fit.need}px)`
  )
  assert.ok(
    Math.abs(fit.leftGap - fit.rightGap) <= 1.5,
    `outline sides must be symmetric (left ${fit.leftGap}px, right ${fit.rightGap}px)`
  )
}

/** 等伪元素 ::before(抓手细条、拉手斜纹都画在这上面)的不透明度落进 [lo, hi] */
async function waitMarkOpacity(handle: Locator, lo: number, hi: number): Promise<void> {
  await handle.evaluate(
    (el, [min, max]) =>
      new Promise<void>((resolve, reject) => {
        const until = performance.now() + 2000
        const tick = (): void => {
          const opacity = Number(getComputedStyle(el, '::before').opacity)
          if (opacity >= min && opacity <= max) resolve()
          else if (performance.now() > until) reject(new Error(`opacity stuck at ${opacity}`))
          else requestAnimationFrame(tick)
        }
        tick()
      }),
    [lo, hi]
  )
}

async function checkHoverMarks(page: Page, panel: Locator): Promise<void> {
  assert.equal(await panel.locator('[title], [data-tip]').count(), 0, 'outline shows no tooltips')
  const grip = panel.locator('.doc-outline-grip')
  const resize = panel.locator('.doc-outline-resize')
  const collapse = panel.locator('.doc-outline-toggle')
  await page.mouse.move(1, 1)
  // 平时:拖动条隐去且不占位,列表紧贴浮窗上缘;拉手斜纹淡淡露着
  await waitBar(panel, false)
  await waitMarkOpacity(resize, 0.3, 0.7)
  const head = await rectOf(panel)
  const first = await rectOf(panel.locator('.doc-outline-item').first())
  assert.ok(first.y - head.y <= 6, 'at rest the list starts right at the panel top (no strip)')
  // 悬停列表中部的条目:不出拖动条
  const mid = await rectOf(panel.locator('.doc-outline-item').nth(3))
  await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2)
  await page.waitForTimeout(300)
  await waitBar(panel, false)
  // 上缘热区只占拖动条那一块(浮窗上边框以外):外侧 3px 能叫出,浮窗内侧 3px 不再算
  await page.mouse.move(head.x + head.width / 2, head.y - 3)
  await waitBar(panel, true)
  await page.mouse.move(1, 1)
  await waitBar(panel, false)
  await page.mouse.move(head.x + head.width / 2, head.y + 3)
  await waitBar(panel, false)
  await page.mouse.move(head.x + head.width / 2, head.y - 3)
  await waitBar(panel, true)
  const bar = await rectOf(panel.locator('.doc-outline-bar'))
  assert.ok(near(bar.y + bar.height, head.y, 1.5), 'bar grows upward from the panel top edge')
  assert.ok(near(bar.x, head.x, 1.5) && near(bar.width, head.width, 1.5), 'bar spans the panel')
  assert.ok(bar.height >= 16, 'bar is roomy when shown')
  assert.ok(near((await rectOf(panel.locator('.doc-outline-item').first())).y, first.y, 0.5))
  // 从热区往上挪进拖动条:两边都算悬停,不收起;离开两者才收起
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2, { steps: 5 })
  await page.waitForTimeout(400)
  await waitBar(panel, true)
  await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2)
  await waitBar(panel, false)
  await revealBar(page, panel)
  const tip = await rectOf(collapse)
  assert.ok(near(tip.x + tip.width, bar.x + bar.width, 1.5), 'collapse sits at the bar right end')
  assert.ok(tip.width >= 16 && tip.height >= 16, 'collapse hit area is at least 16px')
  assert.equal(await grip.evaluate((el) => getComputedStyle(el).cursor), 'grab')
  await resize.hover()
  await waitMarkOpacity(resize, 0.9, 1)
  assert.equal(
    await resize.evaluate((el) => getComputedStyle(el).cursor),
    'nwse-resize',
    'resize grip shows the diagonal resize cursor'
  )
  const p = await rectOf(panel)
  const r = await rectOf(resize)
  assert.ok(
    near(r.x + r.width, p.x + p.width) && near(r.y + r.height, p.y + p.height),
    'resize at bottom-right'
  )
  assert.ok(r.width >= 13.5 && r.height >= 13.5, 'resize hit area is at least 14px')
  // 拉手盖在右下角,不为它在列表底下留白:末条底边离浮窗底只隔正常内边距
  const last = await rectOf(panel.locator('.doc-outline-item').last())
  const pad = await panel.evaluate((el) => {
    const css = getComputedStyle(el)
    return parseFloat(css.paddingBottom) + parseFloat(css.borderBottomWidth)
  })
  assert.ok(near(p.y + p.height - (last.y + last.height), pad, 1.5), 'panel bottom hugs last item')
}

/** 条目多到出竖向滚动条时,自适应宽度要把滚动条算进去,最长那条不被省略号截 */
async function checkScrollbarFit(panel: Locator): Promise<void> {
  const result = await panel.evaluate(async (el) => {
    const host = el as HTMLElement
    host.style.maxHeight = '7rem'
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const list = host.querySelector('.doc-outline-list') as HTMLElement
    const clipped = [...host.querySelectorAll<HTMLElement>('.doc-outline-item')].filter(
      (item) => item.scrollWidth > item.clientWidth
    ).length
    const scrolls = list.scrollHeight > list.clientHeight && list.offsetWidth > list.clientWidth
    host.style.maxHeight = ''
    return { clipped, scrolls }
  })
  assert.ok(result.scrolls, 'squeezed outline must show a vertical scrollbar')
  assert.equal(result.clipped, 0, 'auto-fit width must leave room for the scrollbar')
}

async function checkDragAndClamp(page: Page, panel: Locator): Promise<void> {
  const grip = panel.locator('.doc-outline-grip')
  const start = await rectOf(panel)
  await dragBy(page, grip, -150, 120)
  const moved = await rectOf(panel)
  assert.ok(
    near(moved.x, start.x - 150) && near(moved.y, start.y + 120),
    'grip drag moves the panel'
  )
  const pane = await paneOf(page)
  const viewport = page.viewportSize() ?? { width: 1024, height: 640 }
  await dragTo(page, grip, viewport.width - 1, viewport.height - 1)
  const low = await rectOf(panel)
  assert.ok(low.x + low.width <= pane.right + 0.5, 'drag is clamped at the pane right edge')
  assert.ok(low.y + low.height <= pane.bottom + 0.5, 'drag is clamped at the pane bottom edge')
  await dragTo(page, grip, 1, 1)
  const high = await rectOf(panel)
  assert.ok(high.x >= pane.left - 0.5 && high.y >= pane.top - 0.5, 'drag is clamped at top-left')
  const bar = await rectOf(panel.locator('.doc-outline-bar'))
  assert.ok(
    bar.y >= pane.top - 0.5,
    'top clamp reaches into the header but keeps the hover bar inside'
  )
  assert.ok(
    high.y < (await viewTopOf(page)) - 0.5,
    'the panel can be dragged up over the pane header'
  )
}

/** 按住拉手拖 (dx, dy) 先不松手,量拖动途中的浮窗,再松手 */
async function resizeHolding(page: Page, panel: Locator, dx: number, dy: number): Promise<Rect> {
  const h = await rectOf(panel.locator('.doc-outline-resize'))
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2 + dy, { steps: 6 })
  const during = await rectOf(panel)
  await page.mouse.up()
  return during
}

/** 等松手吸回的过渡走完,宽高稳定在 want 附近 */
async function waitSize(panel: Locator, want: { width: number; height: number }): Promise<void> {
  await panel.evaluate(
    (el, w) =>
      new Promise<void>((resolve, reject) => {
        const until = performance.now() + 2000
        const tick = (): void => {
          const r = el.getBoundingClientRect()
          const fits = Math.abs(r.width - w.width) <= 2 && Math.abs(r.height - w.height) <= 2
          if (fits && !el.classList.contains('is-snapping')) resolve()
          else if (performance.now() > until)
            reject(new Error(`size stuck at ${r.width}x${r.height}, want ${w.width}x${w.height}`))
          else requestAnimationFrame(tick)
        }
        tick()
      }),
    want
  )
}

async function savedSize(page: Page): Promise<{ width: unknown; height: unknown }> {
  const saved = await page.evaluate(() => localStorage.getItem('atlas.docOutlinePlacement'))
  const parsed = JSON.parse(saved ?? '{}') as Record<string, unknown>
  return { width: parsed.width, height: parsed.height }
}

/** 列表底下不留空白:可视高不比全部条目的高多出 4px 以上 */
async function checkNoBottomBlank(panel: Locator): Promise<void> {
  const gap = await panel
    .locator('.doc-outline-list')
    .evaluate((el) => el.clientHeight - el.scrollHeight)
  assert.ok(gap < 4, `outline height must hug the items (blank ${gap}px)`)
}

/** 拉大:途中跟手、松手宽高都吸回内容尺寸(左上角不动、不留空白、回到自适应) */
async function checkResizeSnap(page: Page, panel: Locator, auto: Rect): Promise<void> {
  const during = await resizeHolding(page, panel, 200, 80)
  assert.ok(near(during.width, auto.width + 200), 'width follows the mouse while dragging')
  assert.ok(near(during.height, auto.height + 80), 'height follows the mouse while dragging')
  await waitSize(panel, auto)
  const snapped = await rectOf(panel)
  assert.ok(near(snapped.x, auto.x) && near(snapped.y, auto.y), 'snap keeps the top-left corner')
  await checkHugs(panel)
  await checkNoBottomBlank(panel)
  assert.deepEqual(await savedSize(page), { width: null, height: null }, 'snap returns to auto')
  const pane = await paneOf(page)
  const viewport = page.viewportSize() ?? { width: 1024, height: 640 }
  const maxed = await resizeHolding(page, panel, viewport.width, viewport.height)
  assert.ok(maxed.x + maxed.width <= pane.right + 0.5, 'resize is clamped at the pane right edge')
  assert.ok(maxed.y + maxed.height <= pane.bottom + 0.5, 'resize is clamped at the pane bottom')
  await waitSize(panel, auto)
}

async function checkResizeAndPersist(page: Page, panel: Locator): Promise<void> {
  const grip = panel.locator('.doc-outline-grip')
  // 上一步停在左上角:往右下挪一点,右下角拉手往右下拉才有余地
  await dragBy(page, grip, 100, 60)
  const auto = await rectOf(panel)
  await checkResizeSnap(page, panel, auto)
  await dragBy(page, panel.locator('.doc-outline-resize'), -40, -40)
  const narrowed = await rectOf(panel)
  assert.ok(near(narrowed.width, auto.width - 40), 'narrower than content stays narrower')
  assert.ok(near(narrowed.height, auto.height - 40), 'shorter than content stays shorter')
  assert.ok(near(narrowed.x, auto.x) && near(narrowed.y, auto.y), 'resize keeps the top-left')
  const saved = await savedSize(page)
  assert.ok(
    typeof saved.width === 'number' && typeof saved.height === 'number',
    'smaller size saved'
  )
  const pane = await paneOf(page)
  const offset = { right: pane.right - (narrowed.x + narrowed.width), top: narrowed.y - pane.top }
  // 换一扇阅读签(Word 预览,标题比 outline.md 短、少):同一份全局摆放,右缘与上缘照搬,
  // 记下的宽高比这份的内容尺寸还大,上屏收到内容尺寸,不留空白
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'report.docx' }).click()
  const docxPanel = page.locator(PANEL)
  await docxPanel.waitFor()
  const docxPane = await paneOf(page)
  const reopened = await rectOf(docxPanel)
  assert.ok(near(docxPane.right - (reopened.x + reopened.width), offset.right), 'position persists')
  assert.ok(near(reopened.y - docxPane.top, offset.top), 'top persists across tabs')
  assert.ok(reopened.width < narrowed.width - 4, 'shorter headings clamp the saved width')
  assert.ok(reopened.height < narrowed.height - 4, 'fewer headings clamp the saved height')
  await checkHugs(docxPanel)
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'outline.md' }).click()
  await panel.waitFor()
  await panel.locator('.doc-outline-resize').dblclick()
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('atlas.docOutlinePlacement')
    const p = raw === null ? null : (JSON.parse(raw) as { width: unknown; height: unknown })
    return p !== null && p.width === null && p.height === null
  })
  const reset = await rectOf(panel)
  assert.ok(near(reset.width, auto.width) && near(reset.height, auto.height), 'dblclick resets')
}
export async function checkOutlinePlacement(page: Page): Promise<void> {
  const panel = page.locator(PANEL)
  await panel.waitFor()
  await checkLook(panel)
  await checkScrollbarFit(panel)
  await checkHoverMarks(page, panel)
  await checkOutlineGestures(page, panel)
  await checkDragAndClamp(page, panel)
  await checkResizeAndPersist(page, panel)
}
