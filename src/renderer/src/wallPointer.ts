// 线索桌按住拖动的收尾:除了松手,窗口失焦、指针捕获丢了、或移动时发现左键其实早松开了,都算拖完。
// 免得拖到一半切去别的窗口松手,回来以后还粘在鼠标上。卡片、便签与平移桌面共用。

/** 在 target 上跟踪这一次按住:每次移动回调 onMove,结束时(只一次)回调 onEnd */
export function trackWallPointer(
  target: HTMLElement,
  pointerId: number,
  onMove: (event: PointerEvent) => void,
  onEnd: () => void
): void {
  let done = false
  const move = (event: PointerEvent): void => {
    if ((event.buttons & 1) === 0) {
      end()
      return
    }
    onMove(event)
  }
  const end = (): void => {
    if (done) return
    done = true
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', end)
    target.removeEventListener('pointercancel', end)
    target.removeEventListener('lostpointercapture', end)
    window.removeEventListener('blur', end)
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
    onEnd()
  }
  target.setPointerCapture(pointerId)
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', end)
  target.addEventListener('pointercancel', end)
  target.addEventListener('lostpointercapture', end)
  window.addEventListener('blur', end)
}
