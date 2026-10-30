// 图谱节点详情浮窗的活动范围(纯函数,自测覆盖):位置按「离画布右上角多远」记,
// 面板不压顶栏,拖到画布任何地方都留一条缝,拉尺寸拉不出画布。
// 内容尺寸账与大纲浮窗共用:宽高各记一个「刚好放下内容」的尺寸,拉大松手吸回;
// 高度自适应档就是画布能给的最大高,宽度自适应档由 CSS 变量登记。
import type { FitBounds } from '../floatPlacement'

export interface GraphPanelBoundsInput {
  /** 画布可视区(不含边框) */
  view: { width: number; height: number }
  /** 浮窗此刻的实测大小(宽高没记过时,上限按它算) */
  panel: { width: number; height: number }
  /** 离画布边留的缝 */
  gap: number
  /** 顶栏(面包屑与工具)底边到画布顶的距离,已含那条缝 */
  topInset: number
  /** 浮窗最小宽高(CSS 登记的那一档) */
  min: { width: number; height: number }
  /** 实测内容宽高(null = 没量到,不设上限) */
  natural: { width: number | null; height: number | null }
  /** 自适应档宽度上限(CSS 登记的 --graph-panel-auto-max);高度自适应档就是画布能给的最大高 */
  autoMaxWidth: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

function fitWithin(natural: number | null, lo: number, hi: number): number {
  return natural === null ? hi : clamp(natural, lo, hi)
}

export function graphPanelBounds(g: GraphPanelBoundsInput): FitBounds {
  const minRight = g.gap
  const reachLeft = g.view.width - g.gap
  const reachDown = g.view.height - g.gap
  const minTop = g.topInset
  const maxWidth = Math.max(g.min.width, g.view.width - 2 * g.gap)
  const maxHeight = Math.max(g.min.height, reachDown - minTop)
  return {
    minRight,
    // 宽度没记过时按实测宽夹;记过则 clampPlacement 用记下的宽度重算
    maxRight: Math.max(minRight, reachLeft - g.panel.width),
    minTop,
    maxTop: Math.max(minTop, reachDown - g.panel.height),
    defaultTop: minTop,
    minWidth: g.min.width,
    maxWidth,
    minHeight: g.min.height,
    maxHeight,
    reachLeft,
    reachDown,
    fitWidth: fitWithin(g.natural.width, g.min.width, maxWidth),
    autoMaxWidth: g.autoMaxWidth,
    fitHeight: fitWithin(g.natural.height, g.min.height, maxHeight),
    autoMaxHeight: maxHeight
  }
}
