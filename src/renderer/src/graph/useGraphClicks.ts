// 画布的双击与右键:双击节点 = 主动作(文件打开预览、文件夹进入),右键节点 = 节点菜单。
// 拖拽与空白单击(取消选中)在 useGraphViewport 的指针状态机里处理;这里只接浏览器的 dblclick / contextmenu。
import { useEffect, useRef } from 'react'
import type { Transform } from './drawGraph'
import type { ViewportDeps } from './useGraphViewport'
import { hitTest, localPoint } from './graphHit'

export function useGraphClicks(
  deps: ViewportDeps,
  transformRef: React.RefObject<Transform>,
  /** 右键拖动已经平移过画面:这一次松手不弹节点菜单 */
  rightPanMovedRef: React.RefObject<boolean>
): void {
  const depsRef = useRef(deps)
  useEffect(() => {
    depsRef.current = deps
  })
  const { canvasRef } = deps
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const nodeAt = (e: MouseEvent): ReturnType<typeof hitTest> => {
      const [sx, sy] = localPoint(canvas, e)
      return hitTest(depsRef.current.sceneRef.current, transformRef.current, sx, sy)
    }
    const onDoubleClick = (e: MouseEvent): void => {
      const node = nodeAt(e)
      if (node) depsRef.current.onNodeDoubleClick(node)
    }
    const onContextMenu = (e: MouseEvent): void => {
      // 右键拖动画面的松手:只关掉浏览器菜单,不当成对节点的右键
      if (rightPanMovedRef.current) {
        rightPanMovedRef.current = false
        e.preventDefault()
        return
      }
      const node = nodeAt(e)
      if (!node) return
      e.preventDefault()
      depsRef.current.onNodeContextMenu(node, e.clientX, e.clientY)
    }
    canvas.addEventListener('dblclick', onDoubleClick)
    canvas.addEventListener('contextmenu', onContextMenu)
    return () => {
      canvas.removeEventListener('dblclick', onDoubleClick)
      canvas.removeEventListener('contextmenu', onContextMenu)
    }
  }, [canvasRef, rightPanMovedRef, transformRef])
}
