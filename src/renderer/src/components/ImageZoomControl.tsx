import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IMAGE_ZOOM_PRESETS, parseImageZoomPercent } from '@shared/imageZoom'
import { useMenuDismiss } from '../useMenuDismiss'
import { pinOverlayInViewport } from '../overlayLayout'

/** 单击与双击拆开:等这一阵,没等到第二次点击才弹出档位菜单 */
const CLICK_WAIT_MS = 280

/** 缩放档位菜单:关着 / 钉在底栏芯片 / 钉在右键光标 */
export type ImageZoomMenu =
  { kind: 'closed' } | { kind: 'chip' } | { kind: 'cursor'; x: number; y: number }

function pinMenuToCursor(el: HTMLElement, x: number, y: number): void {
  const view = el.ownerDocument.defaultView
  if (!view) return
  pinOverlayInViewport(el, x, y, view)
}

/**
 * 图片缩放底栏控件:单击上拉档位、双击原地输入百分比。
 * 菜单开闭由调用方管,图片右键与底栏百分比共用同一份。
 * 点外/Esc/滚轮收菜单;回车或失焦提交输入,Esc 放弃。
 */
export function ImageZoomControl({
  percent,
  disabled,
  menu,
  onMenuOpen,
  onMenuClose,
  onPick
}: {
  percent: number
  disabled: boolean
  menu: ImageZoomMenu
  onMenuOpen: () => void
  onMenuClose: () => void
  onPick: (percent: number) => void
}): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const clickTimerRef = useRef<number>(0)
  const skipBlurRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [doc, setDoc] = useState<Document | null>(null)
  const menuOpen = menu.kind !== 'closed'
  if (menuOpen && editing) setEditing(false)

  useLayoutEffect(() => {
    setDoc(wrapRef.current?.ownerDocument ?? document)
  }, [])

  useEffect(() => {
    const win = wrapRef.current?.ownerDocument.defaultView
    return () => {
      if (win && clickTimerRef.current) win.clearTimeout(clickTimerRef.current)
    }
  }, [])

  useLayoutEffect(() => {
    if (menu.kind !== 'cursor') return
    const el = menuRef.current
    if (el) pinMenuToCursor(el, menu.x, menu.y)
  }, [menu])

  useMenuDismiss(
    menuOpen,
    onMenuClose,
    menu.kind === 'cursor' ? '.image-zoom-menu' : '.image-zoom-ctl',
    doc ?? undefined
  )

  function clearClickTimer(): void {
    const win = wrapRef.current?.ownerDocument.defaultView
    if (win && clickTimerRef.current) win.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = 0
  }

  function onButtonClick(): void {
    if (disabled || editing) return
    if (menuOpen) {
      onMenuClose()
      return
    }
    const win = wrapRef.current?.ownerDocument.defaultView
    if (!win) return
    clearClickTimer()
    clickTimerRef.current = win.setTimeout(() => {
      clickTimerRef.current = 0
      onMenuOpen()
    }, CLICK_WAIT_MS)
  }

  function onButtonDoubleClick(e: React.MouseEvent): void {
    e.preventDefault()
    if (disabled) return
    clearClickTimer()
    onMenuClose()
    setDraft(`${percent}%`)
    setEditing(true)
  }

  function commitDraft(raw: string, cancel: boolean): void {
    setEditing(false)
    if (cancel) return
    const next = parseImageZoomPercent(raw)
    if (next === null || next === percent) return
    onPick(next)
  }

  function pick(next: number): void {
    onMenuClose()
    if (next !== percent) onPick(next)
  }

  if (editing) {
    return (
      <div ref={wrapRef} className="image-chip image-zoom-ctl">
        <input
          className="image-zoom-input"
          value={draft}
          size={Math.max(draft.length, 1)}
          aria-label="输入缩放百分比"
          inputMode="numeric"
          spellCheck={false}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={(e) => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false
              return
            }
            commitDraft(e.currentTarget.value, false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              e.preventDefault()
              skipBlurRef.current = true
              commitDraft(draft, true)
            }
            e.stopPropagation()
          }}
        />
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="image-chip image-zoom-ctl">
      <button
        type="button"
        className="image-zoom-btn"
        aria-haspopup="listbox"
        aria-expanded={menu.kind === 'chip'}
        aria-label="缩放百分比,点一下选档位,双击输入"
        disabled={disabled}
        onClick={onButtonClick}
        onDoubleClick={onButtonDoubleClick}
      >
        {percent}%
      </button>
      {menuOpen && (
        <div
          ref={menuRef}
          className={'image-zoom-menu' + (menu.kind === 'cursor' ? ' is-at-cursor' : '')}
          role="listbox"
          aria-label="缩放档位"
          style={menu.kind === 'cursor' ? { left: menu.x, top: menu.y } : undefined}
        >
          {IMAGE_ZOOM_PRESETS.map((step) => (
            <button
              key={step}
              type="button"
              role="option"
              className={'image-zoom-opt' + (step === percent ? ' is-current' : '')}
              aria-selected={step === percent}
              title={`${step}%`}
              onClick={() => pick(step)}
            >
              {step}%
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
