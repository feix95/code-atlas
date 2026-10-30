// 悬停提示框:节点的名称与所属模块。贴在节点上方,上方放不下翻到下方;不吃鼠标。
// 读屏不走这里 —— Canvas 节点没有 DOM,读屏信息在 GraphNodeList 里。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GRAPH_TIP } from '../graph/graphConfig'
import { tipPlacement, type NodeTipText, type TipPlacement } from '../graph/nodeTip'
import type { HoverTarget } from '../graph/useGraphViewport'

export function GraphNodeTip({
  anchor,
  text
}: {
  anchor: HoverTarget
  text: NodeTipText
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<TipPlacement | null>(null)
  const [isShown, setIsShown] = useState(false)

  // 悬停一小会儿才亮:鼠标扫过节点时不闪
  useEffect(() => {
    const timer = window.setTimeout(() => setIsShown(true), GRAPH_TIP.delayMs)
    return () => window.clearTimeout(timer)
  }, [])

  // 先按不可见量出气泡尺寸,再按节点位置落位;画布尺寸从父元素拿,缩放窗口也跟着算
  useLayoutEffect(() => {
    const el = ref.current
    const host = el?.parentElement
    if (!el || !host) return
    const rect = host.getBoundingClientRect()
    const next = tipPlacement(
      anchor,
      { w: el.offsetWidth, h: el.offsetHeight },
      { w: rect.width, h: rect.height }
    )
    setBox((prev) =>
      prev && prev.left === next.left && prev.top === next.top && prev.side === next.side
        ? prev
        : next
    )
  }, [anchor, text.title, text.sub])

  return (
    <div
      ref={ref}
      className={isShown ? 'graph-node-tip is-shown' : 'graph-node-tip'}
      style={{ left: box?.left ?? 0, top: box?.top ?? 0, visibility: box ? 'visible' : 'hidden' }}
      aria-hidden="true"
    >
      <p className="graph-node-tip-name">{text.title}</p>
      {text.sub !== '' && <p className="graph-node-tip-sub">{text.sub}</p>}
    </div>
  )
}
