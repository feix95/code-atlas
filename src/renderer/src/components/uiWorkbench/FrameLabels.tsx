// 顶层画板的名签(Figma 同款):贴在画板左上方、不随缩放变大小。
// 顶层画板的底面点不中(那是「桌面上的纸」,点里面是框选),所以选中、拖动画板靠名签;
// 锁定或隐藏的画板名签不接收指针。
import { useMemo } from 'react'
import type { SceneNode } from '@shared/uiWorkbench/scene'
import { hiddenIds, lockedIds, topLevelFrameIds } from '@shared/uiWorkbench/tree'
import type { Viewport } from '../../uiWorkbench/viewport'

export function FrameLabels({
  nodes,
  selectedIds,
  view,
  onPress
}: {
  nodes: readonly SceneNode[]
  selectedIds: readonly string[]
  view: Viewport
  onPress: (e: React.PointerEvent<HTMLElement>, frameId: string) => void
}): React.JSX.Element {
  const { frames, locked } = useMemo(() => {
    const top = topLevelFrameIds(nodes)
    const hidden = hiddenIds(nodes)
    return {
      frames: nodes.filter((n) => n.type === 'frame' && top.has(n.id) && !hidden.has(n.id)),
      locked: lockedIds(nodes)
    }
  }, [nodes])
  return (
    <>
      {frames.map((frame) =>
        frame.type !== 'frame' ? null : (
          <div
            key={frame.id}
            className={`uwb-frame-label${selectedIds.includes(frame.id) ? ' is-selected' : ''}${locked.has(frame.id) ? ' is-locked' : ''}`}
            style={{
              left: view.panX + frame.x * view.zoom,
              top: view.panY + frame.y * view.zoom,
              maxWidth: Math.max(0, frame.width * view.zoom)
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              if (!locked.has(frame.id)) onPress(e, frame.id)
            }}
          >
            {frame.name}
          </div>
        )
      )}
    </>
  )
}
