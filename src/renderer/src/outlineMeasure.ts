// 大纲浮窗的实测几何:预览栏/停靠坞/浮窗的框、最小宽高、内容宽,交给 outlinePlacement 的纯函数去算。
import { outlineBounds, type OutlineBounds } from './outlinePlacement'

/** 离预览栏四边留的缝(rem) */
const EDGE_GAP_REM = 0.5
/** 自适应档宽/高上限在 CSS 里登记的变量名(doc-outline.css,以 @property 注册成长度,读出来已是 px) */
const AUTO_MAX_VAR = '--outline-auto-max'
const AUTO_MAX_H_VAR = '--outline-auto-max-h'
/** 展开态悬停拖动条的高度变量(长在浮窗上缘之上) */
const BAR_VAR = '--outline-strip'
/** 收起态圆钮相对浮窗右上角的上移 / 外移量(registered 长度,读出来已是 px) */
const KNOB_LIFT_VAR = '--outline-knob-lift'
const KNOB_SHIFT_VAR = '--outline-knob-shift'

export type OutlineRefs = {
  viewRef: React.RefObject<HTMLDivElement | null>
  dockRef: React.RefObject<HTMLDivElement | null>
  panelRef: React.RefObject<HTMLElement | null>
}

export function remPx(el: HTMLElement): number {
  return parseFloat(getComputedStyle(el.ownerDocument.documentElement).fontSize) || 0
}

/** CSS 长度(只认 rem/px)换成 px;认不出 = 不设上限 */
function lengthPx(value: string, rem: number): number {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return Infinity
  return value.trim().endsWith('rem') ? n * rem : n
}

function sumPx(values: string[]): number {
  return values.reduce((sum, v) => sum + (parseFloat(v) || 0), 0)
}

/** 夹边预留量:读不出按 0,不让一条坏变量把上缘顶到栏外 */
function reservePx(css: CSSStyleDeclaration, name: string, rem: number): number {
  const px = lengthPx(css.getPropertyValue(name), rem)
  return Number.isFinite(px) ? px : 0
}

function horizontalChrome(css: CSSStyleDeclaration): number {
  return sumPx([css.paddingLeft, css.paddingRight, css.borderLeftWidth, css.borderRightWidth])
}

/**
 * 最长条目一行排开要多宽(文字实宽 + 条目左右内边距,缩进也算在左内边距里)。
 * 用 Range 量文字本身:条目超宽被省略号截掉时,Range 的框仍是整行原长。
 * 条目多时要逐个读样式,所以由调用方按「条目换了才重量」缓存。没展开(无列表)回 null。
 */
export function measureWidestItem(panel: HTMLElement): number | null {
  const items = panel.querySelectorAll<HTMLElement>('.doc-outline-item')
  if (items.length === 0) return null
  const range = panel.ownerDocument.createRange()
  let widest = 0
  for (const item of items) {
    range.selectNodeContents(item)
    const css = getComputedStyle(item)
    const pad = (parseFloat(css.paddingLeft) || 0) + (parseFloat(css.paddingRight) || 0)
    widest = Math.max(widest, range.getBoundingClientRect().width + pad)
  }
  return widest
}

/** 内容宽 = 最长条目 + 列表两侧常驻的滚动条槽 + 浮窗内边距与边框;向上取整免得差半像素出省略号 */
function naturalWidth(panel: HTMLElement, css: CSSStyleDeclaration, widest: number): number {
  const list = panel.querySelector<HTMLElement>('.doc-outline-list')
  const scrollbar = list ? list.offsetWidth - list.clientWidth : 0
  return Math.ceil(widest + scrollbar + horizontalChrome(css))
}

/** 内容高 = 列表全部条目的高 + 列表内外边距 + 浮窗上下内边距(顶部含拖动条)与边框;没展开回 null。
    按条目逐个累加,不读列表的 scrollHeight:列表被拉高时 scrollHeight 会跟着可视高一起涨
    (滚动容器不会比自己的框矮),量出来是拉伸后的高,松手就吸不回内容尺寸 */
function naturalHeight(panel: HTMLElement, css: CSSStyleDeclaration): number | null {
  const list = panel.querySelector<HTMLElement>('.doc-outline-list')
  if (!list) return null
  const listCss = getComputedStyle(list)
  let content = 0
  for (let i = 0; i < list.children.length; i += 1) {
    content += list.children[i].getBoundingClientRect().height
  }
  const chrome = sumPx([
    listCss.paddingTop,
    listCss.paddingBottom,
    listCss.marginTop,
    listCss.marginBottom,
    css.paddingTop,
    css.paddingBottom,
    css.borderTopWidth,
    css.borderBottomWidth
  ])
  return Math.ceil(content + chrome)
}

export function measureBounds(
  { viewRef, dockRef, panelRef }: OutlineRefs,
  widest: number | null
): OutlineBounds | null {
  const view = viewRef.current
  const dock = dockRef.current
  const panel = panelRef.current
  if (!view || !dock || !panel) return null
  const vr = view.getBoundingClientRect()
  const left = vr.left + view.clientLeft
  const top = vr.top + view.clientTop
  const css = getComputedStyle(panel)
  const rem = remPx(view)
  const knob = {
    shift: reservePx(css, KNOB_SHIFT_VAR, rem),
    lift: reservePx(css, KNOB_LIFT_VAR, rem)
  }
  const open = panel.classList.contains('is-open')
  return outlineBounds({
    view: { left, top, right: left + view.clientWidth, bottom: top + view.clientHeight },
    dock: dock.getBoundingClientRect(),
    panel: { width: panel.offsetWidth, height: panel.offsetHeight },
    gap: rem * EDGE_GAP_REM,
    min: { width: parseFloat(css.minWidth) || 0, height: parseFloat(css.minHeight) || 0 },
    natural: {
      width: widest === null ? null : naturalWidth(panel, css, widest),
      height: naturalHeight(panel, css)
    },
    autoMax: {
      width: lengthPx(css.getPropertyValue(AUTO_MAX_VAR), rem),
      height: lengthPx(css.getPropertyValue(AUTO_MAX_H_VAR), rem)
    },
    // 上缘/右缘下限取拖动条与圆钮位移的较大者:收起/展开共用一套下限,来回切换不挪位
    reserveTop: Math.max(reservePx(css, BAR_VAR, rem), knob.lift),
    reserveRight: knob.shift,
    // 收起态再按圆钮看上去的边外推上限,圆钮才贴得到栏左与栏底
    ...(open ? {} : { knob })
  })
}

export function sameBounds(a: OutlineBounds | null, b: OutlineBounds | null): boolean {
  if (a === null || b === null) return a === b
  // Infinity(没登记上限)减自己是 NaN,先比全等
  return (Object.keys(a) as Array<keyof OutlineBounds>).every(
    (k) => a[k] === b[k] || Math.abs(a[k] - b[k]) < 0.5
  )
}
