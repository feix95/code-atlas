// 线索桌拖动:按下挪过阈值才算拖,拖动中只改草稿位置(线绳实时跟着走),松手才写存档。
// 拖过的那一下不再当点击,免得拖完顺手打开详情。卡片和用户便签共用这一套,只认 id 与起点。
import { useCallback, useRef, useState } from 'react'
import { WALL_DRAG_THRESHOLD } from './wikiWallViewport'

export interface WallDraft {
  id: string
  x: number
  y: number
}

/** 被拖的东西:卡片页 id 或便签 id,加上它按下时的位置 */
export interface WallDragItem {
  id: string
  x: number
  y: number
}

export interface WallCardDrag {
  draft: WallDraft | null
  start: (event: React.PointerEvent<HTMLElement>, item: WallDragItem) => void
  /** 刚拖完的那次点击要吞掉:返回 true 表示这次点击应忽略 */
  consumeClick: () => boolean
}

export function useWallCardDrag(
  zoom: number,
  onCommit: (id: string, x: number, y: number) => void
): WallCardDrag {
  const [draft, setDraft] = useState<WallDraft | null>(null)
  const justDragged = useRef(false)

  const start = useCallback(
    (event: React.PointerEvent<HTMLElement>, item: WallDragItem) => {
      if (event.button !== 0) return
      // 别让桌面以为是在拖空白处平移
      event.stopPropagation()
      const target = event.currentTarget
      const startX = event.clientX
      const startY = event.clientY
      let last: WallDraft | null = null
      target.setPointerCapture(event.pointerId)
      const move = (e: PointerEvent): void => {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        if (last === null && Math.hypot(dx, dy) < WALL_DRAG_THRESHOLD) return
        last = {
          id: item.id,
          x: Math.max(0, Math.round(item.x + dx / zoom)),
          y: Math.max(0, Math.round(item.y + dy / zoom))
        }
        setDraft(last)
      }
      const up = (): void => {
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', up)
        target.removeEventListener('pointercancel', up)
        if (last === null) return
        justDragged.current = true
        onCommit(item.id, last.x, last.y)
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
