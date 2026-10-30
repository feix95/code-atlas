// 图谱节点详情浮窗的实测几何:内容宽高的量法(临时放开宽高上限,量完立刻还原)
// 与活动范围换算(顶栏让位、四边留缝),交给 graphPanelBounds 的纯函数去算。
import type { FitBounds } from '../floatPlacement'
import { lengthPx, remPx } from '../outlineMeasure'
import { graphPanelBounds } from './graphPanelBounds'

/** 离画布四边留的缝(rem) */
const EDGE_GAP_REM = 0.5
/** 自适应档宽度上限在 CSS 里登记的变量名(以 @property 注册成长度,读出来已是 px) */
const AUTO_MAX_VAR = '--graph-panel-auto-max'

/** 内容宽:按 max-content 排一遍再还原,量完立刻回到屏上的样子 */
export function measureNaturalWidth(panel: HTMLElement): number {
  const { style } = panel
  const prevWidth = style.width
  const prevMaxWidth = style.maxWidth
  style.width = 'max-content'
  style.maxWidth = 'none'
  const width = panel.offsetWidth
  style.width = prevWidth
  style.maxWidth = prevMaxWidth
  return width
}

/** 内容高:在当前宽度下放开高度上限量全部内容;列表被拉高时不会被撑大的高骗到 */
export function measureNaturalHeight(panel: HTMLElement): number {
  const { style } = panel
  const prevHeight = style.height
  const prevMaxHeight = style.maxHeight
  style.height = 'auto'
  style.maxHeight = 'none'
  const height = panel.offsetHeight
  style.height = prevHeight
  style.maxHeight = prevMaxHeight
  return height
}

/** 画布里的活动范围:顶栏底边以下、四边留一条缝;内容宽高按实测填进去 */
export function measureGraphPanelBounds(
  view: HTMLElement,
  panel: HTMLElement,
  natural: { width: number; height: number }
): FitBounds {
  const rem = remPx(view)
  const gap = rem * EDGE_GAP_REM
  const viewRect = view.getBoundingClientRect()
  const bar = view.querySelector<HTMLElement>('.graph-bar')
  const barBottom = bar ? bar.getBoundingClientRect().bottom : viewRect.top
  const css = getComputedStyle(panel)
  const autoMax = lengthPx(css.getPropertyValue(AUTO_MAX_VAR), rem)
  return graphPanelBounds({
    view: { width: view.clientWidth, height: view.clientHeight },
    panel: { width: panel.offsetWidth, height: panel.offsetHeight },
    gap,
    topInset: Math.max(gap, barBottom - viewRect.top + gap),
    min: { width: parseFloat(css.minWidth) || 0, height: parseFloat(css.minHeight) || 0 },
    natural: { width: natural.width, height: natural.height },
    autoMaxWidth: autoMax > 0 ? autoMax : Infinity
  })
}
