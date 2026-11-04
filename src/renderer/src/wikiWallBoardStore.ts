// 线索桌摆放位置的本机存档:localStorage + 订阅广播(同 moduleColorStore 的做法),按项目根路径分开存。
// 存档里有、当前卡片里已经没有的页 id(重新规划后页变了)不会被用到,静默忽略。
import { useSyncExternalStore } from 'react'
import {
  sanitizeWallBoardPrefs,
  type WallBoardPrefs,
  type WallPositions
} from './wikiWallPositions.ts'

const KEY = 'atlas.wiki.wall-board'
const EMPTY: WallPositions = {}

function readStored(): WallBoardPrefs {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    return raw === null ? {} : sanitizeWallBoardPrefs(JSON.parse(raw))
  } catch (err) {
    console.warn('[wiki] 线索桌摆放存档读取失败,回落自动摆放', { key: KEY, err })
    return {}
  }
}

let prefs = readStored()
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 摆放存档按「项目 × 层」分开:每一层各记各的手摆位置 */
export function wallPositionsKey(root: string, scope: string): string {
  return `${root}\n${scope}`
}

export function useWallPositions(root: string): WallPositions {
  return useSyncExternalStore(subscribe, () => prefs[root] ?? EMPTY)
}

/** 整份替换一个项目的摆放;空对象 = 回到自动摆放 */
export function setWallPositions(root: string, positions: WallPositions): void {
  const next: Record<string, WallPositions> = { ...prefs }
  if (Object.keys(positions).length === 0) delete next[root]
  else next[root] = positions
  prefs = next
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch (err) {
    // 写不进只影响下次打开,本次会话照常生效
    console.warn('[wiki] 线索桌摆放存档写入失败', { key: KEY, err })
  }
  for (const cb of listeners) cb()
}
