// Ctrl+滚轮缩放界面(浏览器惯例,小葵要的功能):走 setUiScale 原路 —— 落盘 + 根字号 +
// uiScaleChanged 广播 + 主进程窗口记账,全链自动跟上,这里不养第二本账。
// 滚轮每档 ±5%(与设置页 ± 钮同户口);触控板捏合在 Chromium 里也报 ctrl+wheel,
// pinch 缩放白捡;小碎步(触控板一堆 deltaY<100)积累到一整档才翻,不然一蹭跳两档;
// 碎步账超过 400ms 没续上就清账 —— 隔了很久的两下小滚不该合伙凑一档。
import { useEffect, useRef } from 'react'
import { clampUiScale } from '@shared/uiScale'

const STEP = 0.05 // 一档 5%
const NOTCH = 100 // 鼠标一格滚轮 ≈ deltaY 100(deltaMode=0 像素)
const ACC_TTL_MS = 400

export function useWheelZoom(onChange: (scale: number) => void): void {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(() => {
    let acc = 0
    let last = 0
    const apply = (next: number): void => {
      const f = clampUiScale(next)
      if (f === window.atlas.getUiScale()) return
      window.atlas.setUiScale(f)
      onChangeRef.current(f)
    }
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY // 行单位折成像素
      const now = performance.now()
      if (now - last > ACC_TTL_MS) acc = 0
      last = now
      acc += dy
      const steps = Math.trunc(acc / NOTCH)
      if (steps === 0) return
      acc -= steps * NOTCH
      apply(window.atlas.getUiScale() - steps * STEP) // 向下滚(deltaY>0)= 缩小
    }
    // 键盘同款(网页惯例):Ctrl +/-/0;输入框里也一样,没人 Ctrl+0 打字
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const cur = window.atlas.getUiScale()
      if (e.key === '0') apply(1)
      else if (e.key === '+' || e.key === '=') apply(cur + STEP)
      else if (e.key === '-') apply(cur - STEP)
      else return
      e.preventDefault()
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}
