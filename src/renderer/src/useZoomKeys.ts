// 键盘界面缩放(浏览器惯例):Ctrl +/-/0 → 界面缩放,走 setUiScale 原路 —— 落盘 + 根字号 +
// uiScaleChanged 广播 + 主进程窗口记账,全链自动跟上,这里不养第二本账。
// Ctrl+滚轮不归这里:那是页签内容缩放(缩放跟签走,户口 tabZoom.ts),挂在 TabZoomLayer 上 ——
// 界面是界面,文档是文档,两本账分开记。
import { useEffect, useRef } from 'react'
import { clampUiScale } from '@shared/uiScale'

const STEP = 0.05 // 一档 5%,与设置页 ± 钮同户口

/** 往一扇窗上装缩放键(主窗挂 window,子窗壳挂自己的窗):返回拆装函数 */
export function installZoomKeys(win: Window, onChange: (scale: number) => void): () => void {
  const apply = (next: number): void => {
    const f = clampUiScale(next)
    if (f === window.atlas.getUiScale()) return
    window.atlas.setUiScale(f)
    onChange(f)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
    const cur = window.atlas.getUiScale()
    if (e.key === '0') apply(1)
    else if (e.key === '+' || e.key === '=') apply(cur + STEP)
    else if (e.key === '-') apply(cur - STEP)
    else return
    e.preventDefault()
  }
  win.addEventListener('keydown', onKey)
  return () => win.removeEventListener('keydown', onKey)
}

export function useZoomKeys(onChange: (scale: number) => void): void {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(() => installZoomKeys(window, (f) => onChangeRef.current(f)), [])
}
