// 模块改色的本机存档:localStorage + 订阅广播(同 artboardPrefsStore 的做法),按项目根路径分开存。
// 存档里有、当前模块表里已经没有的模块 id(重扫后模块变了)不会被用到,静默忽略。
import { useSyncExternalStore } from 'react'
import {
  sanitizeModuleColorPrefs,
  setModuleColorIn,
  type ColorOverrides,
  type ModuleColorPrefs
} from './moduleColors.ts'

const KEY = 'atlas.graph.module-colors'
const EMPTY: ColorOverrides = new Map()

function readStored(): ModuleColorPrefs {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    return raw === null ? {} : sanitizeModuleColorPrefs(JSON.parse(raw))
  } catch (err) {
    console.warn('[graph] 模块颜色存档读取失败,回落默认', { key: KEY, err })
    return {}
  }
}

let prefs = readStored()
/** 每个项目的 Map 缓存:prefs 不变时返回同一个对象,useSyncExternalStore 才不会反复重渲染 */
let cache = new Map<string, ColorOverrides>()
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function overridesOf(root: string | null): ColorOverrides {
  if (root === null || !prefs[root]) return EMPTY
  let hit = cache.get(root)
  if (!hit) {
    hit = new Map(Object.entries(prefs[root]))
    cache.set(root, hit)
  }
  return hit
}

export function useModuleColorOverrides(root: string | null): ColorOverrides {
  return useSyncExternalStore(subscribe, () => overridesOf(root))
}

/** 改一个模块的颜色;color 为 null = 恢复默认 */
export function setModuleColor(root: string, moduleId: string, color: string | null): void {
  prefs = setModuleColorIn(prefs, root, moduleId, color)
  cache = new Map()
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch (err) {
    // 写不进只影响下次打开,本次会话照常生效
    console.warn('[graph] 模块颜色存档写入失败', { key: KEY, err })
  }
  for (const cb of listeners) cb()
}
