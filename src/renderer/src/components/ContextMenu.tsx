import { Fragment, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  closeContextMenu,
  currentContextMenu,
  isMenuHeading,
  MENU_SEP,
  subscribeContextMenu,
  type ContextMenuRequest
} from './contextMenuStore'
import { useMenuDismiss } from '../useMenuDismiss'
import { TreeIcon } from './Icons'
import { MENU_ICON_ONLY_SIZE, MENU_ICON_SIZE } from '../inputMetrics'
import {
  OVERLAY_EDGE_FALLBACK_PX,
  OVERLAY_MAX_WIDTH_FALLBACK_PX,
  clampOverlayBox,
  clampPreferRightOverlay,
  readTokenPx
} from '../overlayLayout'

/**
 * 通用右键菜单(第二台全局单例):不是「对着文件」的右键菜单走这儿 ——
 * 调用方报坐标 + 行项清单,皮肤复用 file-path-menu 那一套(全 app 右键菜单一个规格)。
 * 行项的 run 返回字符串时,那一行先亮出这句反馈(「已复制 ✓」式)停一拍再关闭。
 * 行项清单里插 MENU_SEP = 组间一道细线(Obsidian 式分组);item.icon 走 TreeIcon 行内图;
 * iconOnly = 纯图标方钮竖排,悬停向右展开露出文字(输入框编辑菜单);
 * compact = 窄身文字档(导出格式那挂);
 * { heading } = 分区小标题;item.switchOn = 开关行(复用设置页 .cfg-switch,点了不关闭)。
 * 渲染域隔离:主窗和每个子窗各挂一台本组件,各认各 document 里的请求。
 */

/** 二级菜单估高还按行数估(飞出层量盒子之前要先落点);主菜单宽高已改成量真实盒子 */
const ROW_H = 34
/** 窄身档的行高(行高 1.2 + 上下边距各 --space-1,和 is-compact 的 CSS 账对得上) */
const ROW_H_COMPACT = 24
/** 纯图标档的方钮边长(2.25rem,100% 缩放下 36px) */
const ROW_H_ICON_ONLY = 36
/** 外框一圈的厚度(边框 + 内边距)在估高里的份额 */
const CHROME = 10
/** 行内反馈停一拍的时长:让人亲眼看到结果,不是菜单凭空消失 */
const LINGER_MS = 900

type MenuPos = {
  left: number
  top: number
  width: number
  pinBottom: number | null
  expandLeft: boolean
}

export function ContextMenu(): React.JSX.Element | null {
  const request = useSyncExternalStore(subscribeContextMenu, currentContextMenu)
  // 渲染域隔离:挂载后从锚点元素认领自家 document,只画「在本 document 里被右键叫出来」的那张菜单
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const [doc, setDoc] = useState<Document | null>(null)
  useLayoutEffect(() => {
    setDoc(anchorRef.current?.ownerDocument ?? document)
  }, [])
  const mine = request !== null && doc !== null && request.doc === doc

  // 菜单开着时的三条退路:点菜单外面、滚动内容、按 Esc —— 都是「用户不要了」,关闭
  useMenuDismiss(mine, closeContextMenu, '.file-path-menu', doc ?? undefined)

  return (
    <>
      <span ref={anchorRef} hidden aria-hidden="true" />
      {mine && doc !== null && (
        <ContextMenuCard key={`${request.x}:${request.y}`} request={request} doc={doc} />
      )}
    </>
  )
}

function ContextMenuCard({
  request,
  doc
}: {
  request: ContextMenuRequest
  doc: Document
}): React.JSX.Element {
  /** 点了某行后该行亮出的反馈文字(行号记账,只亮被点的那行) */
  const [lingering, setLingering] = useState<{ index: number; text: string } | null>(null)
  /** 开关行被拨过之后的当前读数(行号记账):各开关互相独立,菜单自己翻面,不等外面重开 */
  const [flipped, setFlipped] = useState<Record<number, boolean>>({})
  /** 展开的二级菜单(父行号);同一张菜单只开一路 */
  const [expanded, setExpanded] = useState<number | null>(null)
  /** 二级菜单的落点(视口坐标,贴着父行右侧;右边挤不下翻左侧) */
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const iconOnly = request.iconOnly === true
  const noTips = request.noTips === true
  const rowH = iconOnly ? ROW_H_ICON_ONLY : request.compact ? ROW_H_COMPACT : ROW_H
  const view = doc.defaultView ?? window

  // 宽高由 CSS 自适配,量真实盒子再贴窗边;纯图标档右边挤不下就钉右缘往左长
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el || !view) return
    const box = el.getBoundingClientRect()
    const edge = readTokenPx(el, view, '--overlay-edge', OVERLAY_EDGE_FALLBACK_PX)
    const gapX = readTokenPx(el, view, '--space-6', 24)
    const gapY = readTokenPx(el, view, '--space-3', 12)
    const maxW = readTokenPx(el, view, '--overlay-max-width', OVERLAY_MAX_WIDTH_FALLBACK_PX)
    const next: MenuPos = request.preferRight
      ? {
          ...clampPreferRightOverlay({
            x: request.x,
            y: request.y,
            width: box.width,
            height: box.height,
            view,
            edge,
            gapX,
            gapY
          }),
          width: box.width,
          expandLeft: false
        }
      : {
          ...clampOverlayBox(request.x, request.y, box.width, box.height, view, edge),
          width: box.width,
          pinBottom: null,
          expandLeft: false
        }
    if (iconOnly) next.expandLeft = next.left + maxW + edge > view.innerWidth
    setPos((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.width === next.width &&
      prev.pinBottom === next.pinBottom &&
      prev.expandLeft === next.expandLeft
        ? prev
        : next
    )
  }, [request, view, iconOnly, lingering, expanded, flipped])

  /** 二级菜单贴着父行右侧出生;右边挤不下就翻到左侧,上下同样往里收 */
  function clampSub(row: HTMLElement, rows: number): { left: number; top: number } {
    const rect = row.getBoundingClientRect()
    const h = rows * rowH + CHROME
    const edge = readTokenPx(row, view, '--overlay-edge', OVERLAY_EDGE_FALLBACK_PX)
    const subW = readTokenPx(row, view, '--overlay-max-width', OVERLAY_MAX_WIDTH_FALLBACK_PX)
    const fitsRight = rect.right + edge + subW + edge <= view.innerWidth
    const left = fitsRight ? rect.right + edge : Math.max(edge, rect.left - subW - edge)
    return {
      left,
      top: Math.max(edge, Math.min(rect.top, view.innerHeight - h - edge))
    }
  }

  function openSub(index: number, row: HTMLElement): void {
    const item = request.items[index]
    if (item === undefined || item === MENU_SEP || isMenuHeading(item)) return
    const rows = item.children?.length ?? 0
    if (rows === 0) return
    setExpanded(index)
    setSubPos(clampSub(row, rows))
  }
  return (
    <div
      ref={cardRef}
      className={`file-path-menu${iconOnly ? ' is-icon-only' : request.compact ? ' is-compact' : ''}${pos?.expandLeft ? ' is-expand-left' : ''}`}
      style={{
        ...(pos?.expandLeft
          ? { right: view.innerWidth - pos.left - pos.width, left: 'auto' }
          : { left: pos?.left ?? request.x }),
        ...(pos?.pinBottom != null
          ? { top: 'auto', bottom: pos.pinBottom }
          : { top: pos?.top ?? request.y }),
        visibility: pos ? 'visible' : 'hidden'
      }}
      role="menu"
    >
      {request.items.map((item, i) => {
        if (item === MENU_SEP) {
          return <div key={i} className="file-path-menu-sep" role="separator" aria-hidden="true" />
        }
        if (isMenuHeading(item)) {
          return (
            <div
              key={i}
              className="file-path-menu-heading"
              role="presentation"
              title={noTips ? undefined : item.heading}
            >
              {item.heading}
            </div>
          )
        }
        const isSwitch = item.switchOn !== undefined
        const switchOn = flipped[i] ?? item.switchOn === true
        const hasSub = item.children !== undefined && item.children.length > 0
        const caption = lingering?.index === i ? lingering.text : item.label
        return (
          <Fragment key={i}>
            <button
              type="button"
              role={isSwitch ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={isSwitch ? switchOn : undefined}
              aria-expanded={hasSub ? expanded === i : undefined}
              className={`file-path-menu-item${lingering?.index === i ? ' is-ok' : ''}`}
              /* aria-disabled 而非 disabled:Chrome 不给原生禁用按钮派发鼠标事件,
               aria-disabled 是 ARIA 菜单模式的推荐写法,行仍能收到指针事件(悬停样式照常),
               点击由下方 item.disabled 闸手动拦(键盘 Enter 也走同一闸) */
              aria-disabled={item.disabled || undefined}
              aria-haspopup={hasSub ? 'menu' : undefined}
              onPointerEnter={(e) => {
                if (hasSub) openSub(i, e.currentTarget)
                else if (expanded !== null) setExpanded(null)
              }}
              onClick={(e) => {
                if (item.disabled) return
                if (hasSub) {
                  openSub(i, e.currentTarget)
                  return
                }
                if (isSwitch) {
                  setFlipped((f) => ({ ...f, [i]: !switchOn }))
                  void item.run?.(!switchOn)
                  return
                }
                void Promise.resolve(item.run?.()).then((feedback) => {
                  if (typeof feedback !== 'string' || feedback === '') {
                    closeContextMenu()
                    return
                  }
                  setLingering({ index: i, text: feedback })
                  window.setTimeout(closeContextMenu, LINGER_MS)
                })
              }}
            >
              {item.icon !== undefined && (
                <span className="fpm-ic" aria-hidden="true">
                  <TreeIcon
                    name={item.icon}
                    size={iconOnly ? MENU_ICON_ONLY_SIZE : MENU_ICON_SIZE}
                    mono
                  />
                </span>
              )}
              <span className="fpm-label" title={noTips ? undefined : caption}>
                {caption}
              </span>
              {isSwitch && (
                <span
                  className={`cfg-switch fpm-switch${switchOn ? ' is-on' : ''}`}
                  aria-hidden="true"
                >
                  <span />
                </span>
              )}
              {hasSub && (
                <span className="fpm-more" aria-hidden="true">
                  ▸
                </span>
              )}
            </button>
            {hasSub && expanded === i && subPos !== null && (
              <div
                className="file-path-menu fpm-flyout"
                role="menu"
                aria-label={item.label}
                style={{ left: subPos.left, top: subPos.top }}
              >
                {item.children?.map((child, ci) => (
                  <button
                    key={ci}
                    type="button"
                    role="menuitem"
                    className="file-path-menu-item"
                    onClick={() => {
                      closeContextMenu()
                      child.run()
                    }}
                  >
                    <span className="fpm-label" title={noTips ? undefined : child.label}>
                      {child.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
