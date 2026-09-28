import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  closeContextMenu,
  currentContextMenu,
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
 * 行项的 run 返回字符串时,那一行先亮出这句反馈(「已复制 ✓」式)停一拍再收摊。
 * 行项清单里插 MENU_SEP = 组间一道细线(Obsidian 式分组);item.icon 走 TreeIcon 行内图。
 * realm 铁律:主窗和每个子窗各挂一台本组件,各认各 document 里的请求。
 */

/** 菜单的估尺寸:宽窄一条,高按行数算(一项一行约 34px);贴窗口边时按它往里收,别弹出窗外 */
const MENU_W = 200
/** 窄身档的估宽(compact 菜单,比如输入框的复制/粘贴两行) */
const MENU_W_COMPACT = 96
const ROW_H = 34
/** 窄身档的行高(行高 1.2 + 上下边距各 0.25rem ≈ 24px,和 is-compact 的 CSS 账对得上) */
const ROW_H_COMPACT = 24
/** 组间细线在估高里的份额:1px 线 + 上下各 ~3px 外距 */
const SEP_H = 7
/** 外框一圈的厚度(边框 + 内边距)在估高里的份额:通用档 10px,窄身档 6px */
const CHROME = 10
const CHROME_COMPACT = 6
const EDGE = 8
/** 菜单和光标之间的空隙:一个汉字宽(约两个字节,小葵点名的距离感) */
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
  // realm 铁律:挂载后从锚点元素认领自家 document,只画「在本 document 里被右键叫出来」的那张菜单
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const [doc, setDoc] = useState<Document | null>(null)
  useLayoutEffect(() => {
    setDoc(anchorRef.current?.ownerDocument ?? document)
  }, [])
  const mine = request !== null && doc !== null && request.doc === doc

  // 菜单开着时的三条退路:点菜单外面、滚动内容、按 Esc —— 都是「用户不要了」,收摊
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
  const rowH = request.compact ? ROW_H_COMPACT : ROW_H
  const menuH =
    request.items.reduce((h, it) => h + (it === MENU_SEP ? SEP_H : rowH), 0) +
    (request.compact ? CHROME_COMPACT : CHROME)
  const pos = clampedPosition(
    request.x,
    request.y,
    menuH,
    doc.defaultView ?? window,
    request.compact ? MENU_W_COMPACT : MENU_W,
    request.preferRight === true
  )
  return (
    <div
      className={`file-path-menu${request.compact ? ' is-compact' : ''}`}
      style={{ left: pos.left, top: pos.top }}
      role="menu"
    >
      {request.items.map((item, i) =>
        item === MENU_SEP ? (
          <div key={i} className="file-path-menu-sep" role="separator" aria-hidden="true" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`file-path-menu-item${lingering?.index === i ? ' is-ok' : ''}`}
            /* aria-disabled 而非 disabled:Chrome 不给原生禁用按钮派发鼠标事件,
               data-tip 会白挂;aria-disabled 是 ARIA 菜单模式的推荐写法,行仍可悬停读提示,
               点击由下方 item.disabled 闸手动拦(键盘 Enter 也走同一闸) */
            aria-disabled={item.disabled || undefined}
            data-tip={item.tip}
            onClick={() => {
              if (item.disabled) return
              void Promise.resolve(item.run()).then((feedback) => {
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
            {item.checked === true && (
              <span className="fpm-check" aria-hidden="true">
                <TreeIcon name="checkBare" size={MENU_ICON_SIZE - 2} mono />
              </span>
            )}
          </button>
        )
      )}
    </div>
  )
}
