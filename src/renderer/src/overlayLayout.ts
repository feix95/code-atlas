/**
 * 浮层(右键菜单 / 下拉 / tooltip)贴窗边夹紧。
 * 宽高由 CSS 自适配,JS 只负责别弹出窗外;贴边留白读 --overlay-edge,组件里不写死 px。
 */

export const OVERLAY_EDGE_FALLBACK_PX = 8
export const OVERLAY_MAX_WIDTH_FALLBACK_PX = 280

/** 把 CSS token 的指定值换成 px。认 rem 与裸数字(含 160px);读不出来回 fallback。 */
export function tokenToPx(raw: string, rootFontPx: number, fallbackPx: number): number {
  const trimmed = raw.trim()
  const v = Number.parseFloat(trimmed)
  if (!Number.isFinite(v) || v < 0) return fallbackPx
  if (trimmed.endsWith('rem')) return v * rootFontPx
  return v
}

export function readTokenPx(el: Element, view: Window, token: string, fallbackPx: number): number {
  const raw = view.getComputedStyle(el).getPropertyValue(token)
  const root = Number.parseFloat(view.getComputedStyle(el.ownerDocument.documentElement).fontSize)
  const rootPx = Number.isFinite(root) && root > 0 ? root : 16
  return tokenToPx(raw, rootPx, fallbackPx)
}

export function clampOverlayBox(
  x: number,
  y: number,
  width: number,
  height: number,
  view: { innerWidth: number; innerHeight: number },
  edge: number
): { left: number; top: number } {
  return {
    left: Math.max(edge, Math.min(x, view.innerWidth - width - edge)),
    top: Math.max(edge, Math.min(y, view.innerHeight - height - edge))
  }
}

/** 输入框编辑菜单那种:钉在光标右上,底缘用 CSS bottom 钉、真实高度往上长。 */
export function clampPreferRightOverlay(opts: {
  x: number
  y: number
  width: number
  height: number
  view: { innerWidth: number; innerHeight: number }
  edge: number
  gapX: number
  gapY: number
}): { left: number; top: number; pinBottom: number | null } {
  const { x, y, width, height, view, edge, gapX, gapY } = opts
  const fitsRight = x + gapX + width + edge <= view.innerWidth
  const fitsAbove = y - gapY - height >= edge
  return {
    left: fitsRight ? x + gapX : Math.max(edge, x - width - gapX),
    top: fitsAbove ? 0 : Math.min(y + gapY, view.innerHeight - height - edge),
    pinBottom: fitsAbove ? view.innerHeight - y + gapY : null
  }
}

export function pinOverlayInViewport(el: HTMLElement, x: number, y: number, view: Window): void {
  const box = el.getBoundingClientRect()
  const edge = readTokenPx(el, view, '--overlay-edge', OVERLAY_EDGE_FALLBACK_PX)
  const pos = clampOverlayBox(x, y, box.width, box.height, view, edge)
  el.style.left = `${pos.left}px`
  el.style.top = `${pos.top}px`
}
