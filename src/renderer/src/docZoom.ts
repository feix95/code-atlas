// 文档字号缩放的渲染端登记(Ctrl+滚轮本批):localStorage 存档 + 订阅广播。
// 同进程模块单例 —— 子窗 Portal 共享同一个 JS heap,一处滚轮全场预览一起换档;
// localStorage 按 origin 共享,主窗/子窗读写同一格存档,不需要 IPC。
import { useSyncExternalStore } from 'react'
import { clampDocZoom, DOC_ZOOM_STEP } from '@shared/docZoom'

/** 滚轮一格的像素门槛 / 碎步账的保鲜期(Ctrl+滚轮文档缩放用,和界面缩放滚轮同脾气) */
const WHEEL_NOTCH = 100
const WHEEL_ACC_TTL_MS = 400

const KEY = 'atlas.docZoom'

function readStored(): number {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === null ? 1 : clampDocZoom(Number(raw))
  } catch {
    return 1
  }
}

let zoom = readStored()
const listeners = new Set<() => void>()

export function getDocZoom(): number {
  return zoom
}

export function setDocZoom(next: number): void {
  const f = clampDocZoom(next)
  if (f === zoom) return
  zoom = f
  try {
    localStorage.setItem(KEY, String(f))
  } catch {
    // 存档写不进不挡缩放 —— 大不了下回开回 100%
  }
  for (const cb of listeners) cb()
}

export function subscribeDocZoom(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 组件订阅档:返回当前系数,改动即重渲 */
export function useDocZoom(): number {
  return useSyncExternalStore(subscribeDocZoom, getDocZoom)
}

/** 把 Ctrl/Cmd+滚轮接到预览或译文滚动层上:碎步积累成整档才翻,捏合白捡。 */
export function bindDocZoomWheel(el: HTMLElement): () => void {
  let acc = 0
  let last = 0
  const onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    const now = performance.now()
    if (now - last > WHEEL_ACC_TTL_MS) acc = 0
    last = now
    acc += dy
    const steps = Math.trunc(acc / WHEEL_NOTCH)
    if (steps === 0) return
    acc -= steps * WHEEL_NOTCH
    setDocZoom(getDocZoom() - steps * DOC_ZOOM_STEP) // 向下滚(deltaY>0)= 缩小
  }
  el.addEventListener('wheel', onWheel, { passive: false })
  return () => el.removeEventListener('wheel', onWheel)
}
