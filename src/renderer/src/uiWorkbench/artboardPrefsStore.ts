// 画板本机偏好的渲染端存档:localStorage + 订阅广播(同 docZoom 的做法)。
// 子窗 Portal 共享同一个 JS heap,模块单例即全场同步;localStorage 按 origin 共享,不需要 IPC。
import { useSyncExternalStore } from 'react'
import type { ArtboardSize } from '@shared/uiWorkbench/artboard'
import {
  DEFAULT_ARTBOARD_PREFS,
  normalizePresetName,
  recordArtboardSize,
  removeArtboardPreset,
  sanitizeArtboardPrefs,
  saveArtboardPreset,
  type ArtboardPrefs
} from '@shared/uiWorkbench/artboardPrefs'

const KEY = 'atlas.uiWorkbench.artboard'

function readStored(): ArtboardPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === null ? DEFAULT_ARTBOARD_PREFS : sanitizeArtboardPrefs(JSON.parse(raw))
  } catch (err) {
    console.warn('[uiWorkbench] 画板偏好存档读取失败,回落默认', { key: KEY, err })
    return DEFAULT_ARTBOARD_PREFS
  }
}

let prefs = readStored()
const listeners = new Set<() => void>()

function commit(next: ArtboardPrefs): void {
  prefs = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch (err) {
    // 写不进只影响下次打开,本次会话照常生效
    console.warn('[uiWorkbench] 画板偏好存档写入失败', { key: KEY, err })
  }
  for (const cb of listeners) cb()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useArtboardPrefs(): ArtboardPrefs {
  return useSyncExternalStore(subscribe, () => prefs)
}

export const artboardPrefsActions = {
  record(size: ArtboardSize): void {
    commit(recordArtboardSize(prefs, size))
  },
  savePreset(rawName: string, size: ArtboardSize): void {
    const name = normalizePresetName(rawName, size)
    commit(saveArtboardPreset(prefs, { ...size, id: crypto.randomUUID(), name }))
  },
  removePreset(id: string): void {
    commit(removeArtboardPreset(prefs, id))
  }
}
