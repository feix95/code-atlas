// 替身芯片的两段出生:先隐形量出紧凑宽高,再长成页签模样放行跟手。
import { useEffect, useLayoutEffect } from 'react'
import type { TabDragState } from './tabDragTypes'

export function useChipPhase(
  drag: TabDragState | null,
  setDrag: React.Dispatch<React.SetStateAction<TabDragState | null>>,
  chipRef: React.RefObject<HTMLDivElement | null>
): void {
  // born:芯片以紧凑胶囊态隐形上墙,量出内容宽高 → enter 把矩形改成源页签大小
  useLayoutEffect(() => {
    if (drag?.phase !== 'born' || !chipRef.current) return
    const r = chipRef.current.getBoundingClientRect()
    setDrag((d) =>
      d && d.phase === 'born' ? { ...d, compactW: r.width, compactH: r.height, phase: 'enter' } : d
    )
  }, [drag?.phase, chipRef, setDrag])

  // enter:至少让「页签模样」画上一帧,再放 phase→drag —— 收缩形变才有起帧
  useEffect(() => {
    if (drag?.phase !== 'enter') return
    const raf = requestAnimationFrame(() =>
      setDrag((d) => (d && d.phase === 'enter' ? { ...d, phase: 'drag' } : d))
    )
    return () => cancelAnimationFrame(raf)
  }, [drag?.phase, setDrag])
}
