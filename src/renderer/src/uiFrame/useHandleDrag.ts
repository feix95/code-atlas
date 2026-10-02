// 拖动手柄(§5.6「像拉窗口那样」):按下即捕获指针,移动中实时预览、不加缓动,松手提交一次进撤销栈。
// 默认 0.125rem 步长吸附 + 同族变量磁吸;按住 Alt 自由拖。
import { useRef, useState } from 'react'
import { dragDelta, resolveDrag, type HandleDef } from '@shared/uiFrame/handles'
import { resolvePx } from '@shared/uiFrame/resolve'
import { defaultTokens } from '@shared/uiFrame/template'
import type { TokenValue, UiFrameDoc } from '@shared/uiFrame/types'
import { describePx } from '@shared/uiFrame/units'

const DEFAULTS = defaultTokens()

export interface DragBadge {
  label: string
  text: string
}

export function useHandleDrag({
  doc,
  scale,
  onPreview,
  onCommit
}: {
  doc: UiFrameDoc
  /** 画布缩放比例:屏幕位移 ÷ scale = 逻辑像素位移 */
  scale: number
  /** 拖动中:用临时方案刷新画布(不进撤销栈) */
  onPreview: (draft: UiFrameDoc) => void
  onCommit: (token: string, value: TokenValue) => void
}): {
  badge: DragBadge | null
  dragging: boolean
  startDrag: (e: React.PointerEvent<HTMLElement>, handle: HandleDef) => void
} {
  const [badge, setBadge] = useState<DragBadge | null>(null)
  const activeRef = useRef(false)

  function startDrag(e: React.PointerEvent<HTMLElement>, handle: HandleDef): void {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget
    const startPx = resolvePx(doc.tokens, handle.token) ?? 0
    const startX = e.clientX
    const startY = e.clientY
    let latest: TokenValue | null = null
    activeRef.current = true
    target.setPointerCapture(e.pointerId)

    const onMove = (ev: PointerEvent): void => {
      const dx = (ev.clientX - startX) / scale
      const dy = (ev.clientY - startY) / scale
      const raw = startPx + dragDelta(handle.edge, dx, dy) * handle.factor
      const out = resolveDrag(doc.tokens, DEFAULTS, handle, raw, ev.altKey)
      latest = out.value
      const def = doc.tokens[handle.token]
      onPreview({ ...doc, tokens: { ...doc.tokens, [handle.token]: { ...def, value: out.value } } })
      setBadge({
        label: handle.label,
        text: `${describePx(out.px, doc.rootFontPx)}${out.magnet ? ` · = --${out.magnet}` : ''}`
      })
    }
    const finish = (): void => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      activeRef.current = false
      setBadge(null)
      if (latest) onCommit(handle.token, latest)
      else onPreview(doc)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
    setBadge({ label: handle.label, text: describePx(startPx, doc.rootFontPx) })
  }

  return { badge, dragging: badge !== null, startDrag }
}
