// ── 第九十八锤:手动备注 ──
// 小葵给文件/文件夹写的一句话备注,存在本机 localStorage(不进项目、不进仓库、不上传)。
// 显示优先级:你的备注 > AI 判词(将来)> 引擎一句话。
// 垃圾回收铁律(小葵立的):单项目备注上限 200 条,超出按"最久未更新"淘汰;
// 存储键按项目路径归一化,同一项目换大小写/斜杠方向不会裂成两份垃圾。

import type { ScanDirNode } from './types.ts'

export const NOTES_MAX = 200
/** 一句话备注的字数上限:超了截断,别让备注长成作文 */
export const NOTE_MAX_CHARS = 100
const KEY_PREFIX = 'atlas.notes:'

export interface NoteEntry {
  /** 备注正文(已去首尾空白) */
  text: string
  /** 最后更新时刻(ms),垃圾回收按它淘汰最旧的 */
  t: number
}

export type NoteMap = Record<string, NoteEntry>

/** 项目路径 → 存储键:斜杠统一、去掉收尾斜杠、统一小写,防同一项目裂成两份 */
export function notesStorageKey(rootPath: string): string {
  return KEY_PREFIX + rootPath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 原文 → 干净的备注表(纯函数,自测覆盖):垃圾整条扔、超长截断、超量淘汰最旧 */
export function parseNotes(raw: unknown): NoteMap {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const entries: Array<{ relPath: string; entry: NoteEntry }> = []
  for (const [relPath, value] of Object.entries(raw as Record<string, unknown>)) {
    if (relPath === '' || typeof value !== 'object' || value === null) continue
    const v = value as Record<string, unknown>
    if (typeof v['text'] !== 'string' || typeof v['t'] !== 'number' || !Number.isFinite(v['t']) || v['t'] <= 0) continue
    const text = v['text'].trim().slice(0, NOTE_MAX_CHARS)
    if (text === '') continue
    entries.push({ relPath, entry: { text, t: v['t'] } })
  }
  entries.sort((a, b) => b.entry.t - a.entry.t)
  const out: NoteMap = {}
  for (const { relPath, entry } of entries.slice(0, NOTES_MAX)) out[relPath] = entry
  return out
}

/** 增/改/删一条(纯函数,自测覆盖):text 空串 = 删除;其余更新正文并盖新时间戳,超量淘汰最旧 */
export function upsertNote(map: NoteMap, relPath: string, text: string, ts: number): NoteMap {
  const trimmed = text.trim().slice(0, NOTE_MAX_CHARS)
  const kept = Object.entries(map).filter(([k]) => k !== relPath)
  if (trimmed !== '') kept.push([relPath, { text: trimmed, t: ts }])
  kept.sort((a, b) => b[1].t - a[1].t)
  const out: NoteMap = {}
  for (const [k, v] of kept.slice(0, NOTES_MAX)) out[k] = v
  return out
}

/**
 * 对照扫描树清孤儿(纯函数,自测覆盖):树里已经不存在的路径,备注一并回收。
 * 只有"确知看全了"的目录才敢判孤儿 —— lazy(还没展开)和 truncated(被预算掐断)的目录
 * 底下可能有没露面的节点,它们名下的备注一律保留,宁可多留不误删。
 */
export function pruneNotesAgainstTree(map: NoteMap, tree: ScanDirNode): NoteMap {
  const alive = new Set<string>()
  const unsurePrefixes: string[] = []
  const walk = (node: ScanDirNode, known: boolean): void => {
    const selfKnown = known && !node.lazy && !node.truncated
    alive.add(node.relPath)
    if (!selfKnown) unsurePrefixes.push(node.relPath)
    for (const child of node.children) {
      if (child.type === 'directory') walk(child, selfKnown)
      else alive.add(child.relPath)
    }
  }
  walk(tree, true)
  const out: NoteMap = {}
  for (const [relPath, entry] of Object.entries(map)) {
    if (alive.has(relPath)) {
      out[relPath] = entry
      continue
    }
    const underUnsure = unsurePrefixes.some((p) => p !== '' && (relPath === p || relPath.startsWith(`${p}/`)))
    if (underUnsure) out[relPath] = entry
  }
  return out
}

function readRaw(key: string): unknown {
  try {
    const text = localStorage.getItem(key)
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

export function loadNotes(rootPath: string): NoteMap {
  return parseNotes(readRaw(notesStorageKey(rootPath)))
}

export function saveNotes(rootPath: string, map: NoteMap): void {
  try {
    localStorage.setItem(notesStorageKey(rootPath), JSON.stringify(map))
  } catch {
    // 写不进去就算了:备注是锦上添花,不该惊动任何人
  }
}

/** 读 → 清孤儿 → 写回(垃圾不越攒越多),再回给界面。开项目扫完时喊这一声 */
export function refreshNotesForScan(rootPath: string, tree: ScanDirNode): NoteMap {
  const pruned = pruneNotesAgainstTree(loadNotes(rootPath), tree)
  saveNotes(rootPath, pruned)
  return pruned
}
