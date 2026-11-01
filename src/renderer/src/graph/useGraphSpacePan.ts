// 空格临时手型:指针落在画布上、且没在输入框或编辑器里打字时,按住空格进入平移准备状态。
// 圆铺满画面时没有空白可拖,按住空格就能从任意位置起拖;焦点在输入框里时空格仍照常打字。
import { useEffect, useRef } from 'react'
import { isEditableTarget } from '../isEditableTarget'

/** 空格按住期间把 heldRef 置真;状态变化时调用 onChange 让调用方刷新光标 */
export function useGraphSpacePan(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  heldRef: { current: boolean },
  onChange: () => void
): void {
  const overRef = useRef(false)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // 切回图谱页时指针可能已经停在画布上,先按当前悬停状态初始化
    overRef.current = canvas.matches(':hover')
    const setHeld = (held: boolean): void => {
      if (heldRef.current === held) return
      heldRef.current = held
      onChangeRef.current()
    }
    const onEnter = (): void => {
      overRef.current = true
    }
    const onLeave = (): void => {
      overRef.current = false
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || !overRef.current || isEditableTarget(e.target)) return
      e.preventDefault()
      setHeld(true)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setHeld(false)
    }
    const onBlur = (): void => setHeld(false)
    canvas.addEventListener('pointerenter', onEnter)
    canvas.addEventListener('pointerleave', onLeave)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      canvas.removeEventListener('pointerenter', onEnter)
      canvas.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      setHeld(false)
    }
  }, [canvasRef, heldRef])
}
