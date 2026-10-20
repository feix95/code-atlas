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
import { MENU_ICON_SIZE } from '../inputMetrics'

/**
 * 通用右键菜单(第二台全局单例):不是「对着文件」的右键菜单走这儿 ——
 * 调用方报坐标 + 行项清单,皮肤复用 file-path-menu 那一套(全 app 右键菜单一个规格)。
 * 行项的 run 返回字符串时,那一行先亮出这句反馈(「已复制 ✓」式)停一拍再关闭。
 * 行项清单里插 MENU_SEP = 组间一道细线(Obsidian 式分组);item.icon 走 TreeIcon 行内图;
 * { heading } = 分区小标题;item.switchOn = 开关行(复用设置页 .cfg-switch,点了不关闭)。
 * 渲染域隔离:主窗和每个子窗各挂一台本组件,各认各 document 里的请求。
 */

/** 菜单的估尺寸:宽窄一条,高按行数算(一项一行约 34px);贴窗口边时按它往里收,别弹出窗外 */
const MENU_W = 200
/** 二级菜单估宽:语种名最长「中文（简体）」,10rem 够摆 */
const SUB_W = 190
/** 父行右缘到二级菜单左缘的缝:让开一级菜单的 4px 内边距,再留 2px 视觉缝 */
const SUB_GAP = 6
/** 窄身档的估宽(compact 菜单,比如输入框的复制/粘贴两行) */
const MENU_W_COMPACT = 96
const ROW_H = 34
/** 窄身档的行高(行高 1.2 + 上下边距各 0.25rem ≈ 24px,和 is-compact 的 CSS 账对得上) */
const ROW_H_COMPACT = 24
/** 组间细线在估高里的份额:1px 线 + 上下各 ~3px 外距 */
const SEP_H = 7
/** 分区小标题行的估高:小字一行 + 上下透气 */
const HEADING_H = 26
/** 外框一圈的厚度(边框 + 内边距)在估高里的份额:通用档 10px,窄身档 6px */
const CHROME = 10
const CHROME_COMPACT = 6
const EDGE = 8
/** 菜单和光标之间的空隙:一个汉字宽(约两个字节,产品指定的距离感) */
const CURSOR_GAP = 12
/** 行内反馈停一拍的时长:让人亲眼看到结果,不是菜单凭空消失 */
const LINGER_MS = 900

function clampedPosition(
  x: number,
  y: number,
  menuH: number,
  view: Window,
  menuW: number,
  preferRight: boolean
): { left: number; top: number } {
  if (preferRight) {
    // 正右侧出生:框以光标为高线居中,左缘隔空一个汉字;右边挤不下就翻到光标左边
    const fitsRight = x + CURSOR_GAP + menuW + EDGE <= view.innerWidth
    return {
      left: fitsRight ? x + CURSOR_GAP : Math.max(EDGE, x - menuW - CURSOR_GAP),
      top: Math.max(EDGE, Math.min(y - menuH / 2, view.innerHeight - menuH - EDGE))
    }
  }
  return {
    left: Math.max(EDGE, Math.min(x, view.innerWidth - menuW - EDGE)),
    top: Math.max(EDGE, Math.min(y, view.innerHeight - menuH - EDGE))
  }
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
  const rowH = request.compact ? ROW_H_COMPACT : ROW_H
  const entryH = (it: (typeof request.items)[number]): number =>
    it === MENU_SEP ? SEP_H : isMenuHeading(it) ? HEADING_H : rowH
  const baseH =
    request.items.reduce((h, it) => h + entryH(it), 0) + (request.compact ? CHROME_COMPACT : CHROME)
  const menuH = baseH
  const pos = clampedPosition(
    request.x,
    request.y,
    menuH,
    doc.defaultView ?? window,
    request.compact ? MENU_W_COMPACT : MENU_W,
    request.preferRight === true
  )

  /** 二级菜单贴着父行右侧出生;右边挤不下就翻到左侧,上下同样往里收 */
  function clampSub(row: HTMLElement, rows: number): { left: number; top: number } {
    const view = doc.defaultView ?? window
    const rect = row.getBoundingClientRect()
    const h = rows * rowH + CHROME
    const fitsRight = rect.right + SUB_GAP + SUB_W + EDGE <= view.innerWidth
    const left = fitsRight ? rect.right + SUB_GAP : Math.max(EDGE, rect.left - SUB_W - SUB_GAP)
    return {
      left,
      top: Math.max(EDGE, Math.min(rect.top, view.innerHeight - h - EDGE))
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
      className={`file-path-menu${request.compact ? ' is-compact' : ''}`}
      style={{ left: pos.left, top: pos.top }}
      role="menu"
    >
      {request.items.map((item, i) => {
        if (item === MENU_SEP) {
          return <div key={i} className="file-path-menu-sep" role="separator" aria-hidden="true" />
        }
        if (isMenuHeading(item)) {
          return (
            <div key={i} className="file-path-menu-heading" role="presentation">
              {item.heading}
            </div>
          )
        }
        const isSwitch = item.switchOn !== undefined
        const switchOn = flipped[i] ?? item.switchOn === true
        const hasSub = item.children !== undefined && item.children.length > 0
        return (
          <Fragment key={i}>
            <button
              type="button"
              role={isSwitch ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={isSwitch ? switchOn : undefined}
              aria-expanded={hasSub ? expanded === i : undefined}
              className={`file-path-menu-item${lingering?.index === i ? ' is-ok' : ''}`}
              /* aria-disabled 而非 disabled:Chrome 不给原生禁用按钮派发鼠标事件,
               data-tip 会白挂;aria-disabled 是 ARIA 菜单模式的推荐写法,行仍可悬停读提示,
               点击由下方 item.disabled 闸手动拦(键盘 Enter 也走同一闸) */
              aria-disabled={item.disabled || undefined}
              data-tip={item.tip}
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
                  <TreeIcon name={item.icon} size={MENU_ICON_SIZE} mono />
                </span>
              )}
              <span className="fpm-label">
                {lingering?.index === i ? lingering.text : item.label}
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
                    <span className="fpm-label">{child.label}</span>
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
