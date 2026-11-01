// 标签改色的本机存档:localStorage + 订阅广播(同 moduleColorStore 的做法),按项目根路径分开存。
// 存档里有、当前 Wiki 里已经没有的标签不会被用到,静默忽略。
import { useSyncExternalStore } from 'react'
import {
  sanitizeColorPrefs,
  setColorIn,
  type ColorOverrides,
  type ColorPrefs
} from './colorPrefs.ts'
import { tagColorKey, TAG_COLOR_KEY as KEY } from './tagColors.ts'

const EMPTY: ColorOverrides = new Map()

function readStored(): ColorPrefs {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    return raw === null ? {} : sanitizeColorPrefs(JSON.parse(raw))
  } catch (err) {
    console.warn('[graph] 标签颜色存档读取失败,回落默认', { key: KEY, err })
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

export function useTagColorOverrides(root: string | null): ColorOverrides {
  return useSyncExternalStore(subscribe, () => overridesOf(root))
}

/** 改一个标签的颜色;color 为 null = 恢复默认 */
export function setTagColor(root: string, tag: string, color: string | null): void {
  prefs = setColorIn(prefs, root, tagColorKey(tag), color)
  cache = new Map()
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch (err) {
    // 写不进只影响下次打开,本次会话照常生效
    console.warn('[graph] 标签颜色存档写入失败', { key: KEY, err })
  }
  for (const cb of listeners) cb()
}
