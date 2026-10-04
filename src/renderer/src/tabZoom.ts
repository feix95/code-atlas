// 页签内容缩放账本(Ctrl+滚轮,缩放跟签走这锤):档跟页签走、不跟文档走 ——
// Map<tabId, 系数>,纯内存账;同签换文档不换档,同文档开在两签各记各的。
// 页签 id 在会话恢复时重新发号(sessionState 走 nextTabId),所以户口不存档、
// 重启天然回 100% —— 档随签生灭,这正是「跟签绑定」的字面语义。
// 同进程模块单例 —— 子窗 Portal 共享同一个 JS heap,一处滚轮全场同签一起换档。
import { useSyncExternalStore } from 'react'
import { clampDocZoom } from '@shared/docZoom'

/** 滚轮一格的像素门槛 / 碎步账的保鲜期(和界面缩放滚轮同脾气,原住 CodePreview) */
export const WHEEL_NOTCH = 100
export const WHEEL_ACC_TTL_MS = 400

const zooms = new Map<string, number>()
const listeners = new Set<() => void>()

/** 这个签的当前系数(没记过 = 100%) */
export function getTabZoom(tabId: string): number {
  return zooms.get(tabId) ?? 1
}

export function setTabZoom(tabId: string, next: number): void {
  const f = clampDocZoom(next)
  if (f === getTabZoom(tabId)) return
  if (f === 1) zooms.delete(tabId)
  else zooms.set(tabId, f)
  for (const cb of listeners) cb()
}

export function subscribeTabZoom(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 组件订阅档:返回这个签的当前系数,改动即重渲 */
export function useTabZoom(tabId: string): number {
  return useSyncExternalStore(subscribeTabZoom, () => getTabZoom(tabId))
}
