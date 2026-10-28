// journey 的大纲浮窗手势卫生一段:顶边点阵按整个浮窗居中;只点不拖不进拖动态、不抢焦点;
// 拖到一半窗口失焦、拖到一半换了页签,拖动态都当场收尾,回来不残留;收起态圆钮分清点开与拖动。
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright'

/** 大纲浮窗挂在预览面板上(阅读栏的兄弟),按可见认当前那扇 */
const PANEL = '.doc-outline.is-open:visible'

async function centerOf(loc: Locator): Promise<{ x: number; y: number }> {
  const box = await loc.boundingBox()
  assert.ok(box, 'element must have a box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** 等悬停拖动条露面(可见且停留延迟走完)或隐去(visibility:hidden);inside 是浮窗或其中任一元素 */
export async function waitBar(inside: Locator, shown: boolean): Promise<void> {
  await inside.evaluate(
    (el, want) =>
      new Promise<void>((resolve, reject) => {
        const bar = el.closest('.doc-outline')?.querySelector('.doc-outline-bar')
        const until = performance.now() + 2000
        const tick = (): void => {
          const css = bar ? getComputedStyle(bar) : null
          // 露面要等停留延迟走完,得等它可见、过渡收尾再量尺寸、点按钮
          const settled = bar ? bar.getAnimations().length === 0 : true
          const on = css !== null && css.visibility === 'visible' && settled
          const off = css === null || css.visibility === 'hidden'
          if (want ? on : off) resolve()
          else if (performance.now() > until)
            reject(new Error(`bar ${want ? 'never showed' : 'never hid'}`))
          else requestAnimationFrame(tick)
        }
        tick()
      }),
    shown
  )
}

/** 拖动条平时隐身:鼠标挪到浮窗上边框以外、与拖动条同一块地盘的中心,把它叫出来 */
export async function revealBar(page: Page, panel: Locator): Promise<void> {
  const box = await panel.boundingBox()
  assert.ok(box, 'panel must have a box')
  const half = await panel.evaluate(
    () => (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 2
  )
  await page.mouse.move(box.x + box.width / 2, box.y - half)
  await waitBar(panel, true)
}

/** 叫出拖动条后把鼠标挪到抓手中心;返回抓手中心 */
export async function hoverGrip(page: Page, panel: Locator): Promise<{ x: number; y: number }> {
  await revealBar(page, panel)
  const at = await centerOf(panel.locator('.doc-outline-grip'))
  await page.mouse.move(at.x, at.y)
  return at
}
const isDragging = (panel: Locator): Promise<boolean> =>
  panel.evaluate((el) => el.classList.contains('is-dragging'))

async function checkGripCentered(panel: Locator): Promise<void> {
  const offset = await panel.evaluate((el) => {
    const grip = el.querySelector('.doc-outline-grip')
    const bar = el.querySelector('.doc-outline-bar')
    if (!grip || !bar) return Number.NaN
    const dots = getComputedStyle(grip, '::before')
    const shift = new DOMMatrixReadOnly(dots.transform).m41
    const left = bar.getBoundingClientRect().left + parseFloat(dots.left) + shift
    const p = el.getBoundingClientRect()
    return left + parseFloat(dots.width) / 2 - (p.left + p.width / 2)
  })
  assert.ok(Math.abs(offset) <= 1, `grip dots must sit at the panel center (off by ${offset}px)`)
}

async function checkClickOnly(page: Page, panel: Locator): Promise<void> {
  const before = await panel.boundingBox()
  await hoverGrip(page, panel)
  await page.mouse.down()
  assert.equal(await isDragging(panel), false, 'pressing alone is not a drag')
  await page.mouse.up()
  assert.equal(await isDragging(panel), false, 'click without moving leaves no drag state')
  const focused = await page.evaluate(() =>
    Boolean(document.activeElement?.closest('.doc-outline-bar'))
  )
  assert.equal(focused, false, 'mouse press must not park focus in the strip')
  assert.deepEqual(await panel.boundingBox(), before, 'a plain click does not move the panel')
}

async function checkBlurEndsDrag(page: Page, panel: Locator): Promise<void> {
  const at = await hoverGrip(page, panel)
  await page.mouse.down()
  await page.mouse.move(at.x - 30, at.y + 20, { steps: 3 })
  assert.equal(await isDragging(panel), true, 'moving while pressed starts a drag')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.waitForFunction(() => !document.querySelector('.doc-outline.is-dragging'))
  const parked = await panel.boundingBox()
  await page.mouse.move(at.x - 120, at.y + 90, { steps: 3 })
  assert.deepEqual(await panel.boundingBox(), parked, 'after blur the panel no longer follows')
  await page.mouse.up()
}

/** 按住抓手拖到一半就换签(脚本点文件树,鼠标仍按着),换回来不该还在拖 */
async function checkTabSwitchEndsDrag(page: Page): Promise<void> {
  const panel = page.locator(PANEL)
  const at = await hoverGrip(page, panel)
  await page.mouse.down()
  await page.mouse.move(at.x - 20, at.y + 10, { steps: 3 })
  assert.equal(await isDragging(panel), true)
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('.tree-row.is-file .tree-main')]
    rows.find((row) => row.textContent?.includes('report.docx'))?.click()
  })
  await page.locator('.docx-body:visible').first().waitFor()
  await page.mouse.up()
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'outline.md' }).click()
  await panel.waitFor()
  await page.mouse.move(1, 1)
  assert.equal(await isDragging(panel), false, 'switching tabs mid-drag leaves no drag state')
  await waitBar(panel, false)
}

export async function checkOutlineGestures(page: Page, panel: Locator): Promise<void> {
  await checkGripCentered(panel)
  await checkClickOnly(page, panel)
  await checkBlurEndsDrag(page, panel)
  await checkTabSwitchEndsDrag(page)
}

const near = (a: number, b: number, tol = 2): boolean => Math.abs(a - b) <= tol

async function savedPosition(page: Page): Promise<{ right: unknown; top: unknown }> {
  const raw = await page.evaluate(() => localStorage.getItem('atlas.docOutlinePlacement'))
  const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>
  return { right: parsed.right, top: parsed.top }
}

/** 拖动收起态圆钮时,圆钮外的方形外壳(浮窗根、顶栏)不许有底色、边框、磨砂,只露圆钮 */
async function checkOnlyCircleShows(toggle: Locator): Promise<void> {
  const shells = await toggle.evaluate((el) => {
    const root = el.closest('.doc-outline')
    const bar = el.closest('.doc-outline-bar')
    const knob = el.getBoundingClientRect()
    return [root, bar].map((shell) => {
      const css = shell ? getComputedStyle(shell) : null
      const box = shell?.getBoundingClientRect()
      return {
        dragging: root?.classList.contains('is-dragging') ?? false,
        bg: css?.backgroundColor ?? '',
        border: css ? parseFloat(css.borderTopWidth) : -1,
        filter: css?.backdropFilter ?? '',
        fits: box
          ? Math.abs(box.width - knob.width) < 1 && Math.abs(box.height - knob.height) < 1
          : false
      }
    })
  })
  for (const shell of shells) {
    assert.ok(shell.dragging, 'circle drag must be in progress')
    assert.ok(
      /rgba\(0, 0, 0, 0\)|transparent/.test(shell.bg),
      `shell behind circle must be transparent (${shell.bg})`
    )
    assert.equal(shell.border, 0, 'shell behind circle has no border')
    assert.ok(
      shell.filter === 'none' || shell.filter === '',
      'shell behind circle has no backdrop blur'
    )
    assert.ok(shell.fits, 'shell is exactly circle-sized')
  }
}

/**
 * 收起态圆钮:按住挪够 4px 是拖动(松手不展开,位置落盘、换签照搬);挪不够就是点开,
 * 展开后浮窗右上角对齐圆钮右上角。调用时大纲已收起,结束时已展开。
 */
export async function checkCircleDrag(page: Page, toggle: Locator): Promise<void> {
  const start = await toggle.boundingBox()
  assert.ok(start, 'collapsed toggle must have a box')
  assert.equal(await toggle.evaluate((el) => getComputedStyle(el).cursor), 'grab')
  const at = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x - 120, at.y + 80, { steps: 6 })
  await checkOnlyCircleShows(toggle)
  await page.mouse.up()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'dragging must not open')
  const moved = await toggle.boundingBox()
  assert.ok(moved && near(moved.x, start.x - 120) && near(moved.y, start.y + 80), 'circle moves')
  const saved = await savedPosition(page)
  assert.ok(typeof saved.right === 'number' && typeof saved.top === 'number', 'position saved')
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'report.docx' }).click()
  const docxToggle = page.locator('.doc-outline-toggle:visible')
  await docxToggle.waitFor()
  const there = await docxToggle.boundingBox()
  assert.ok(there && near(there.x, moved.x) && near(there.y, moved.y), 'circle position persists')
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: 'outline.md' }).click()
  await toggle.waitFor()
  await page.mouse.move(at.x - 120, at.y + 80)
  await page.mouse.down()
  await page.mouse.move(at.x - 118, at.y + 81)
  await page.mouse.up()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'a tiny wiggle still opens')
  const panelLoc = page.locator(PANEL)
  const panel = await panelLoc.boundingBox()
  assert.ok(panel, 'open panel must have a box')
  // 圆钮中心 = 收起钮中心:面板右缘比圆钮右缘内收 shift,上缘比圆钮上缘下沉 lift
  const offsets = await panelLoc.evaluate((el) => {
    const css = getComputedStyle(el)
    return {
      shift: parseFloat(css.getPropertyValue('--outline-knob-shift')),
      lift: parseFloat(css.getPropertyValue('--outline-knob-lift'))
    }
  })
  assert.ok(
    Number.isFinite(offsets.shift) && Number.isFinite(offsets.lift),
    'knob offsets readable'
  )
  assert.ok(
    near(panel.x + panel.width, moved.x + moved.width - offsets.shift),
    'expanded panel right edge sits under the knob center'
  )
  assert.ok(
    near(panel.y, moved.y + offsets.lift),
    'expanded panel top edge sits under the knob center'
  )
}
