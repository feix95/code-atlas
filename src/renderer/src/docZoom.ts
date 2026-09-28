// 文档字号缩放的渲染端户口(Ctrl+滚轮这锤):localStorage 存档 + 订阅广播。
// 同进程模块单例 —— 子窗 Portal 共享同一个 JS heap,一处滚轮全场预览一起换档;
// localStorage 按 origin 共享,主窗/子窗读写同一格存档,不需要 IPC。
import { useSyncExternalStore } from 'react'
import { clampDocZoom } from '@shared/docZoom'

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
