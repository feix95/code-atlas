// 线索桌近景的视口裁剪范围:平移、缩放、改窗口大小后按帧(rAF)合并重算一次;
// 范围没变就不触发重画。远景返回 null = 不裁(远景另有自己的轻量画法)。纯计算在 wikiWallCull。
import { useEffect, useState, type RefObject } from 'react'
import { nextWallCullRect, wallViewRect, type WallRect } from './wikiWallCull'
import type { WallView } from './wikiWallViewport'

export function useWallCull(
  hostRef: RefObject<HTMLDivElement | null>,
  view: WallView,
  far: boolean
): WallRect | null {
  const [cull, setCull] = useState<WallRect | null>(null)
  useEffect(() => {
    const el = hostRef.current
    if (el === null) return
    let frame = 0
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // 还没量到尺寸(隐藏中)就先全画,免得露白
        if (far || el.clientWidth === 0 || el.clientHeight === 0) {
          setCull(null)
          return
        }
        const rect = wallViewRect(view, el.clientWidth, el.clientHeight)
        setCull((prev) => nextWallCullRect(prev, rect))
      })
    }
    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [hostRef, view, far])
  return cull
}
