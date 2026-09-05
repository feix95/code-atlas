import { useEffect, useState } from 'react'

/**
 * 窗口当前是不是最大化:悬浮态(圆角描边)和贴满屏幕是两副面孔,
 * 渲染进程跟着这个状态换装,不然最大化时四个角漏出怪缝。
 */
export function useWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    let alive = true
    // 先问一次现状(窗口可能开屏就是最大化),再订阅后续变化
    void window.atlas.windowIsMaximized().then((v) => {
      if (alive) setMaximized(v)
    })
    const off = window.atlas.onWindowMaximized(setMaximized)
    return () => {
      alive = false
      off()
    }
  }, [])
  return maximized
}
