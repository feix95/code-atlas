// 持久列表工厂(渲染端):localStorage + 订阅广播,同 artboardPrefsStore 的做法。
// 矩形样式库、直线样式库、样式组库共用这一份,不各写一遍读写与订阅。
// 子窗 Portal 共享同一个 JS heap,模块单例即全场同步;localStorage 按 origin 共享,不需要 IPC。
import { useSyncExternalStore } from 'react'

export interface PersistentList<T> {
  /** React 订阅读取 */
  use: () => readonly T[]
  /** 非 React 场景读取当前值 */
  get: () => readonly T[]
  /** 整体替换并落盘、广播 */
  set: (next: readonly T[]) => void
}

/** key:存档键;label:日志里的库名;sanitize:把 JSON.parse 结果校验成合法列表(坏条目丢弃) */
export function createPersistentList<T>(
  key: string,
  label: string,
  sanitize: (value: unknown) => T[]
): PersistentList<T> {
  function readStored(): readonly T[] {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? [] : sanitize(JSON.parse(raw))
    } catch (err) {
      console.warn(`[uiWorkbench] ${label}存档读取失败,回落空表`, { key, err })
      return []
    }
  }

  let list = readStored()
  const listeners = new Set<() => void>()
  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }

  return {
    use: () => useSyncExternalStore(subscribe, () => list),
    get: () => list,
    set(next) {
      list = next
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch (err) {
        // 写不进只影响下次打开,本次会话照常生效
        console.warn(`[uiWorkbench] ${label}存档写入失败`, { key, err })
      }
      for (const cb of listeners) cb()
    }
  }
}
