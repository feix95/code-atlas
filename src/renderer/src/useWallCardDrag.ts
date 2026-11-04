// 线索桌拖卡:按下挪过阈值才算拖,拖动中只改草稿位置(线绳实时跟着走),松手才写存档。
// 拖过的那一下不再当点击,免得拖完顺手打开详情。
import { useCallback, useRef, useState } from 'react'
import type { WallPlacedCard } from './wikiWallLayout'
import { WALL_DRAG_THRESHOLD } from './wikiWallViewport'

export interface WallDraft {
  pageId: string
  x: number
  y: number
}

export interface WallCardDrag {
  draft: WallDraft | null
  start: (event: React.PointerEvent<HTMLElement>, placed: WallPlacedCard) => void
  /** 刚拖完的那次点击要吞掉:返回 true 表示这次点击应忽略 */
  consumeClick: () => boolean
}

export function useWallCardDrag(
  zoom: number,
  onCommit: (pageId: string, x: number, y: number) => void
): WallCardDrag {
  const [draft, setDraft] = useState<WallDraft | null>(null)
  const justDragged = useRef(false)

  const start = useCallback(
    (event: React.PointerEvent<HTMLElement>, placed: WallPlacedCard) => {
      if (event.button !== 0) return
      // 别让桌面以为是在拖空白处平移
      event.stopPropagation()
      const target = event.currentTarget
      const startX = event.clientX
      const startY = event.clientY
      const pageId = placed.card.pageId
      let last: WallDraft | null = null
      target.setPointerCapture(event.pointerId)
      const move = (e: PointerEvent): void => {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        if (last === null && Math.hypot(dx, dy) < WALL_DRAG_THRESHOLD) return
        last = {
          pageId,
          x: Math.max(0, Math.round(placed.x + dx / zoom)),
          y: Math.max(0, Math.round(placed.y + dy / zoom))
        }
        setDraft(last)
      }
      const up = (): void => {
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', up)
        target.removeEventListener('pointercancel', up)
        if (last === null) return
        justDragged.current = true
        onCommit(pageId, last.x, last.y)
        setDraft(null)
      }
      target.addEventListener('pointermove', move)
      target.addEventListener('pointerup', up)
      target.addEventListener('pointercancel', up)
    },
    [zoom, onCommit]
  )

  const consumeClick = useCallback(() => {
    const dragged = justDragged.current
    justDragged.current = false
    return dragged
  }, [])

  return { draft, start, consumeClick }
}
