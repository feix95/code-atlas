// 画布拖动平移:按住空格 + 左键拖,或中键拖(Figma / PS 同款)。
// 同时记录鼠标是否停在画布上(isHoveredRef),供空格键与缩放快捷键判断是否归画布处理。
import { useEffect, useRef, useState } from 'react'
import type { Viewport } from './viewport.ts'
import { isEditableTarget } from './isEditableTarget.ts'

/** idle = 普通;ready = 空格已按下待拖(抓手光标);panning = 正在拖 */
export type PanMode = 'idle' | 'ready' | 'panning'

const MIDDLE_BUTTON = 1
const LEFT_BUTTON = 0

export function usePointerPan(
  ref: React.RefObject<HTMLDivElement | null>,
  isHoveredRef: React.RefObject<boolean>,
  setView: React.Dispatch<React.SetStateAction<Viewport>>
): { panMode: PanMode; onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void } {
  const [panMode, setPanMode] = useState<PanMode>('idle')
  const isSpaceHeldRef = useRef(false)
  useSpaceKey(ref, isHoveredRef, isSpaceHeldRef, setPanMode)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const enter = (): void => void (isHoveredRef.current = true)
    const leave = (): void => void (isHoveredRef.current = false)
    el.addEventListener('pointerenter', enter)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointerleave', leave)
    }
  }, [ref, isHoveredRef])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    const isPanGesture =
      e.button === MIDDLE_BUTTON || (e.button === LEFT_BUTTON && isSpaceHeldRef.current)
    if (!isPanGesture) return
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    let lastX = e.clientX
    let lastY = e.clientY
    setPanMode('panning')
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - lastX
      const dy = ev.clientY - lastY
      lastX = ev.clientX
      lastY = ev.clientY
      setView((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }))
    }
    const end = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
      setPanMode(isSpaceHeldRef.current ? 'ready' : 'idle')
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  return { panMode, onPointerDown }
}

/** 空格:鼠标在画布上且焦点不在输入框时按下 = 进入待拖;松开或窗口失焦 = 退出 */
function useSpaceKey(
  ref: React.RefObject<HTMLDivElement | null>,
  isHoveredRef: React.RefObject<boolean>,
  isSpaceHeldRef: React.RefObject<boolean>,
  setPanMode: React.Dispatch<React.SetStateAction<PanMode>>
): void {
  useEffect(() => {
    const win = ref.current?.ownerDocument.defaultView
    if (!win) return
    const down = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || !isHoveredRef.current || isEditableTarget(e.target)) return
      e.preventDefault()
      if (isSpaceHeldRef.current) return
      isSpaceHeldRef.current = true
      setPanMode((m) => (m === 'panning' ? m : 'ready'))
    }
    const release = (): void => {
      if (!isSpaceHeldRef.current) return
      isSpaceHeldRef.current = false
      setPanMode((m) => (m === 'panning' ? m : 'idle'))
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') release()
    }
    win.addEventListener('keydown', down, true)
    win.addEventListener('keyup', up, true)
    win.addEventListener('blur', release)
    return () => {
      win.removeEventListener('keydown', down, true)
      win.removeEventListener('keyup', up, true)
      win.removeEventListener('blur', release)
    }
  }, [ref, isHoveredRef, isSpaceHeldRef, setPanMode])
}
