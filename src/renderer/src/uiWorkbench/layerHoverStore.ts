// 图层面板的悬停联动:鼠标停在哪一行,画布上就描出对应对象(Figma 同款)。
// 只是示意,不进文档、不入撤销;模块单例 + 订阅,同 documentStore 的做法。
import { useSyncExternalStore } from 'react'

let hoveredId: string | null = null
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function setHoveredLayer(id: string | null): void {
  if (id === hoveredId) return
  hoveredId = id
  for (const cb of listeners) cb()
}

export function useHoveredLayer(): string | null {
  return useSyncExternalStore(subscribe, () => hoveredId)
}
