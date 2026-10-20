/** 原文 / 译文滚动联动:哪栏在滚哪栏当主,把鼠标压着的那一块(块内比例一起)对到另一栏同一高度。
 *
 * 只认滚动,不认单纯移动鼠标 —— 鼠标负责蓝色高亮,滚轮负责对齐。
 * 被带着滚的那栏加一把短锁,它自己的 scroll 事件不再往回传,避免两栏互踢。
 * 块号来自 LinkedMdView 的 data-md-block,两栏同号,所以块边界永远能硬对齐。
 */
import { alignDelta, anchorAt, clampScroll, topAnchor, type BlockRect } from '@shared/scrollAlign'

/** 程序化滚动后多久内忽略该栏的 scroll 事件(毫秒):一帧多一点点,够事件回环走完 */
const ECHO_LOCK_MS = 80

interface Pane {
  fileKey: string
  paneId: string
  el: HTMLElement
  /** 指针最近一次在这栏里的 y;null = 没进来过/已离开 */
  mouseY: number | null
  /** 在这个时刻之前,本栏的 scroll 事件当作回环回声忽略 */
  lockUntil: number
  raf: number | null
}

const panes = new Map<string, Pane>()

function paneKey(fileKey: string, paneId: string): string {
  return `${fileKey}::${paneId}`
}

function contentOf(el: HTMLElement): HTMLElement | null {
  return el.querySelector<HTMLElement>('.md-linked')
}

/** 量出本栏每个块在视口里的矩形(只读,别在这之前写 DOM) */
function rectsOf(el: HTMLElement): BlockRect[] {
  const content = contentOf(el)
  if (!content) return []
  const nodes = content.querySelectorAll<HTMLElement>(':scope > [data-md-block]')
  const rects: BlockRect[] = []
  for (const node of nodes) {
    const index = Number(node.dataset.mdBlock)
    if (!Number.isFinite(index)) continue
    const rect = node.getBoundingClientRect()
    rects.push({ index, top: rect.top, height: rect.height })
  }
  return rects
}

/** 把主栏的锚点对到所有同文件的其它栏上 */
function drive(master: Pane): void {
  const masterRects = rectsOf(master.el)
  if (masterRects.length === 0) return

  const view = master.el.getBoundingClientRect()
  if (view.height <= 0) return
  const hasMouse = master.mouseY !== null && master.mouseY > view.top && master.mouseY < view.bottom
  const refY = hasMouse && master.mouseY !== null ? master.mouseY : view.top
  const anchor = anchorAt(masterRects, refY) ?? topAnchor(masterRects, view.top)
  if (anchor === null) return
  const refRatio = (refY - view.top) / view.height
  const now = performance.now()

  for (const peer of panes.values()) {
    if (peer.fileKey !== master.fileKey || peer === master) continue
    const peerContent = contentOf(peer.el)
    if (!peerContent) continue
    const node = peerContent.querySelector<HTMLElement>(
      `:scope > [data-md-block="${anchor.index}"]`
    )
    if (!node) continue

    const peerView = peer.el.getBoundingClientRect()
    const peerRect = node.getBoundingClientRect()
    const peerRefY = peerView.top + refRatio * peerView.height
    const delta = alignDelta({
      fraction: anchor.fraction,
      peerTop: peerRect.top,
      peerHeight: peerRect.height,
      refY: peerRefY
    })
    const max = peer.el.scrollHeight - peer.el.clientHeight
    const target = clampScroll(peer.el.scrollTop + delta, max)
    if (Math.abs(target - peer.el.scrollTop) < 1) continue

    peer.lockUntil = now + ECHO_LOCK_MS
    peer.el.scrollTop = target
  }
}

/** 登记一栏(返回注销函数);同一栏重复登记时以最后一次为准 */
export function registerMdScroll(fileKey: string, paneId: string, el: HTMLElement): () => void {
  const key = paneKey(fileKey, paneId)
  const pane: Pane = { fileKey, paneId, el, mouseY: null, lockUntil: 0, raf: null }
  panes.set(key, pane)

  const onScroll = (): void => {
    if (performance.now() < pane.lockUntil) return
    if (pane.raf !== null) return
    pane.raf = requestAnimationFrame(() => {
      pane.raf = null
      if (performance.now() < pane.lockUntil) return
      drive(pane)
    })
  }
  const onMove = (event: PointerEvent): void => {
    pane.mouseY = event.clientY
  }
  const onLeave = (): void => {
    pane.mouseY = null
  }

  el.addEventListener('scroll', onScroll, { passive: true })
  el.addEventListener('pointermove', onMove, { passive: true })
  el.addEventListener('pointerleave', onLeave)

  // 刚挂上时先对一次:原文栏后来挂上、或译文栏从别的签切回来(re-mount),
  // 都以原文当前读到哪为基准把对方拉齐,不用等用户再滚一下
  requestAnimationFrame(() => {
    if (panes.get(key) !== pane) return
    const source = [...panes.values()].find(
      (p) => p.fileKey === fileKey && p.paneId === 'source' && p !== pane
    )
    if (source) drive(source)
    else if (paneId === 'source') drive(pane)
  })

  return () => {
    if (pane.raf !== null) cancelAnimationFrame(pane.raf)
    el.removeEventListener('scroll', onScroll)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerleave', onLeave)
    if (panes.get(key) === pane) panes.delete(key)
  }
}
