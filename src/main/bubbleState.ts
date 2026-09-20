// ── 气泡窗的尺寸存档(气泡放大锤,2026-09-21)──
// 用户拖过多大就记多大,下次开气泡还是这个尺寸。存 userData/bubble-state.json,
// 口径学 mascotState:存档是上辈子的记忆,垃圾内容回 null 走默认尺寸;
// 比当前屏幕还大的存档不在这儿砍 —— 落点/缩放时对着现在的工作区夹(bubblePlacement)。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUBBLE_MIN_WIDTH, BUBBLE_MIN_HEIGHT } from './bubblePlacement.ts'

/** 记事本里的一页:气泡窗的宽高(用户调的尺寸) */
export interface BubbleSize {
  width: number
  height: number
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 记事本原文 → 干净的尺寸;垃圾内容回 null(纯函数,自测覆盖)。
 * 比下限还小的捞回下限 —— 存档可能是老版本写的,别生出一扇憋屈窗。 */
export function parseBubbleSize(raw: unknown): BubbleSize | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>
  if (!isFiniteNumber(s['width']) || !isFiniteNumber(s['height'])) return null
  return {
    width: Math.max(BUBBLE_MIN_WIDTH, Math.round(s['width'])),
    height: Math.max(BUBBLE_MIN_HEIGHT, Math.round(s['height']))
  }
}

function stateFilePath(dir: string): string {
  return join(dir, 'bubble-state.json')
}

/** 读记事本;没记过/读不动/内容是垃圾,一律回 null(调用方走默认尺寸) */
export function readBubbleSize(dir: string): BubbleSize | null {
  const file = stateFilePath(dir)
  if (!existsSync(file)) return null
  try {
    return parseBubbleSize(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/** 写记事本;写不进去就算了 —— 记尺寸是锦上添花,不该惊动任何人 */
export function writeBubbleSize(dir: string, size: BubbleSize): void {
  try {
    writeFileSync(stateFilePath(dir), JSON.stringify(size, null, 2), 'utf8')
  } catch {
    // 安静放过
  }
}
