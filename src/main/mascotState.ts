// ── 桌宠的位置存档(桌宠托管第二锤,2026-09-18)──
// 拖到哪儿记哪儿,重启回原地。存 userData/mascot-state.json,口径学 window-state:
// 存档是上辈子的记忆,这辈子的屏幕未必还是那样 —— 落窗前必须对着现在的屏幕夹紧。
// 纯逻辑都住这儿(不碰 electron),自测脚本拖得进来秒跑。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 桌宠窗的边长(正方形),和 mascot.ts 的窗参数一口约定,改一处必改两处 */
export const MASCOT_SIZE = 140

/** 默认落角时离屏幕边的空当:贴太边容易被任务栏/输入法框遮住 */
const MASCOT_EDGE = 24

/** 记事本里的一页:桌宠左上角在屏幕上的位置 */
export interface MascotState {
  x: number
  y: number
}

/** 是不是一个能用的有限数字(不认 NaN/Infinity/字符串) */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 记事本原文 → 干净的位置;垃圾内容回 null(纯函数,自测覆盖)。
 * x/y 允许负数(多屏时主屏左边的屏是负坐标);顺手取整。 */
export function parseMascotState(raw: unknown): MascotState | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>
  if (!isFiniteNumber(s['x']) || !isFiniteNumber(s['y'])) return null
  return { x: Math.round(s['x']), y: Math.round(s['y']) }
}

/** 旧位置对着「现在接着的屏幕」落位(纯函数,自测覆盖)。
 * 有存档:挑交叠最大的屏当家,整体夹回屏内(桌宠小,全须全尾看得见就行)。
 * 没存档:落主屏右下角,离边留空当。workAreas 为空(理论兜底)就不给坐标,交给系统。 */
export function placeMascotBox(
  saved: MascotState | null,
  workAreas: Array<{ x: number; y: number; width: number; height: number }>
): { x?: number; y?: number; width: number; height: number } {
  if (workAreas.length === 0) return { width: MASCOT_SIZE, height: MASCOT_SIZE }
  if (!saved) {
    const home = workAreas[0]
    return {
      x: home.x + home.width - MASCOT_SIZE - MASCOT_EDGE,
      y: home.y + home.height - MASCOT_SIZE - MASCOT_EDGE,
      width: MASCOT_SIZE,
      height: MASCOT_SIZE
    }
  }
  // 挑旧位置跟哪块屏交叠最大,就认哪块当家
  let home = workAreas[0]
  let best = -1
  for (const wa of workAreas) {
    const w = Math.min(saved.x + MASCOT_SIZE, wa.x + wa.width) - Math.max(saved.x, wa.x)
    const h = Math.min(saved.y + MASCOT_SIZE, wa.y + wa.height) - Math.max(saved.y, wa.y)
    const area = w > 0 && h > 0 ? w * h : 0
    if (area > best) {
      best = area
      home = wa
    }
  }
  const x = Math.min(Math.max(saved.x, home.x), home.x + home.width - MASCOT_SIZE)
  const y = Math.min(Math.max(saved.y, home.y), home.y + home.height - MASCOT_SIZE)
  return { x, y, width: MASCOT_SIZE, height: MASCOT_SIZE }
}

function stateFilePath(dir: string): string {
  return join(dir, 'mascot-state.json')
}

/** 读记事本;没记过/读不动/内容是垃圾,一律回 null(调用方走默认落角) */
export function readMascotState(dir: string): MascotState | null {
  const file = stateFilePath(dir)
  if (!existsSync(file)) return null
  try {
    return parseMascotState(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/** 写记事本;写不进去就算了 —— 记位置是锦上添花,不该惊动任何人 */
export function writeMascotState(dir: string, state: MascotState): void {
  try {
    writeFileSync(stateFilePath(dir), JSON.stringify(state, null, 2), 'utf8')
  } catch {
    // 安静放过
  }
}
