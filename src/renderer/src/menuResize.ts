/** 工作区菜单的底边拉伸口径:纯计算,不碰 DOM(自测见 scripts/selftest-menuresize.mts)。
 *
 * 上限取三者最小:
 * 1. 条目全展开的总高 —— 拉到头正好看全,不留空白;
 * 2. 窗口高度的三分之二;
 * 3. 菜单顶边到窗口底的可用距离(极小窗口的兜底)。
 */

/** 菜单最高不超过窗口竖边的这个比例 */
export const MENU_MAX_VIEWPORT_RATIO = 2 / 3

/** 菜单底边与窗口底之间留的余量(px) */
export const MENU_VIEWPORT_MARGIN = 8

export interface MenuHeightBounds {
  min: number
  max: number
}

export function menuHeightBounds(
  contentHeight: number,
  menuTop: number,
  viewportHeight: number,
  minHeight: number
): MenuHeightBounds {
  const min = Number.isFinite(minHeight) ? Math.max(0, minHeight) : 0
  if (
    !Number.isFinite(contentHeight) ||
    !Number.isFinite(menuTop) ||
    !Number.isFinite(viewportHeight)
  ) {
    return { min, max: min }
  }
  const byViewport = Math.min(
    viewportHeight * MENU_MAX_VIEWPORT_RATIO,
    viewportHeight - menuTop - MENU_VIEWPORT_MARGIN
  )
  return { min, max: Math.max(min, Math.min(contentHeight, byViewport)) }
}

export function clampMenuHeight(height: number, bounds: MenuHeightBounds): number {
  if (!Number.isFinite(height)) return bounds.min
  return Math.min(Math.max(height, bounds.min), bounds.max)
}
