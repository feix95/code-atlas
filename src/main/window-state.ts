// ── 第七十八锤:窗口尺寸记事本 ──
// 用户上回把窗拉到多大、搁在哪儿,下回开就照旧;最大化单独记一票,还原时先落回上次的
// 正常大小再最大化。存 userData/window-state.json —— 应用自己的小账本,不碰项目文件。
// 存档是「上辈子的记忆」,这辈子的屏幕未必还是那样:拔过显示器、换过分辨率、缩放改过,
// 都可能让旧存档把窗送出屏外。所以落窗前必须过两道安检(纯函数,自测覆盖):
// ① parseWindowState 只认干净数字,大小不小于窗口下限;
// ② placeWindowBox 把窗贴着「现在接着的屏幕」夹紧 —— 挑交叠最大的那块工作区,
//    露不出一条边就拽回屏内,块头超屏就夹到屏大。

import { join } from 'node:path'
import { readJsonFile, writeJsonFile } from '../shared/jsonFile.ts'
import { clampUiScale } from '../shared/uiScale.ts'

/** 一扇窗的位置和块头;x/y 在「还没接到屏幕」时可以缺(交给系统居中) */
export interface WindowBox {
  x?: number
  y?: number
  width: number
  height: number
}

/** 记事本里的一页:正常状态下的窗框 + 当时是不是最大化。
 *  scale(UI 重构 v3·§2.2)= 存档时界面缩放系数;有它,box 的宽高就是「100% 基准值」,
 *  落窗前乘回 scale 得物理尺寸 —— 缩放档怎么换,窗口比例恒等。
 *  老存档没这字段:box 当年就是按物理像素记的,直接当物理框用,下回落盘自动转成基准值 */
export interface WindowState {
  box: WindowBox
  maximized: boolean
  scale?: number
}

/** 窗口最小尺寸:存档安检的下限、createWindow 的窗框下限,同认这一份 */
export const WINDOW_MIN_WIDTH = 960
export const WINDOW_MIN_HEIGHT = 640

/** 贴屏夹紧时,至少要露出来这么多才算「看得见」,不然当没这块屏 */
const KEEP_VISIBLE_X = 120
const KEEP_VISIBLE_Y = 80
/** 拽回屏内时离工作区边的空当 */
const REST_EDGE = 32

/** 是不是一个能用的有限数字(不认 NaN/Infinity/字符串) */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 记事本原文 → 干净的窗框;垃圾内容回 null(纯函数,自测覆盖)。
 * x/y 允许负数(多屏时主屏左边的屏是负坐标);宽高就地夹到下限,上限交给贴屏那步。
 * scale 只在「有限且 >0」时认账;认了 scale 的存档,box 是基准值,
 * 下限要按系数折回基准口径再夹(基准下限 = 物理下限 ÷ scale)。
 */
export function parseWindowState(raw: unknown): WindowState | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const boxRaw = (raw as Record<string, unknown>)['box']
  if (boxRaw === null || typeof boxRaw !== 'object' || Array.isArray(boxRaw)) return null
  const b = boxRaw as Record<string, unknown>
  if (!isFiniteNumber(b['width']) || !isFiniteNumber(b['height'])) return null
  if (!isFiniteNumber(b['x']) || !isFiniteNumber(b['y'])) return null
  const scaleRaw = (raw as Record<string, unknown>)['scale']
  const scale = isFiniteNumber(scaleRaw) && scaleRaw > 0 ? clampUiScale(scaleRaw) : undefined
  const s = scale ?? 1
  return {
    box: {
      x: Math.round(b['x']),
      y: Math.round(b['y']),
      width: Math.max(WINDOW_MIN_WIDTH / s, Math.round(b['width'])),
      height: Math.max(WINDOW_MIN_HEIGHT / s, Math.round(b['height']))
    },
    maximized: (raw as Record<string, unknown>)['maximized'] === true,
    // scale 没认下就不带这个键 —— 「老存档」和「没这字段」在对象上要长一个样
    ...(scale === undefined ? {} : { scale })
  }
}

/** 存档框 → 物理框:宽高乘回 scale;坐标是屏幕物理值,不乘(纯函数,自测覆盖) */
export function physicalWindowBox(state: WindowState): WindowBox {
  const s = state.scale ?? 1
  return {
    x: state.box.x,
    y: state.box.y,
    width: Math.round(state.box.width * s),
    height: Math.round(state.box.height * s)
  }
}

/** 物理框 → 存档基准框:宽高折回 100% 口径;x/y 照抄(纯函数,自测覆盖) */
export function baseWindowBox(physical: WindowBox, scale: number): WindowBox {
  const s = isFiniteNumber(scale) && scale > 0 ? scale : 1
  return {
    x: physical.x,
    y: physical.y,
    width: Math.round(physical.width / s),
    height: Math.round(physical.height / s)
  }
}

/** 两块矩形的交叠面积(不搭界回 0) */
function intersectionArea(
  a: WindowBox,
  b: { x: number; y: number; width: number; height: number }
): number {
  const w = Math.min(a.x! + a.width, b.x + b.width) - Math.max(a.x!, b.x)
  const h = Math.min(a.y! + a.height, b.y + b.height) - Math.max(a.y!, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** 拿旧窗框对着「现在接着的屏幕」落位(纯函数,自测覆盖)。
 * workAreas 为空(理论兜底)就不给坐标,让系统自己居中。
 */
export function placeWindowBox(
  box: WindowBox,
  workAreas: Array<{ x: number; y: number; width: number; height: number }>
): WindowBox {
  if (workAreas.length === 0) return { width: box.width, height: box.height }
  const widest = Math.max(...workAreas.map((w) => w.width))
  const tallest = Math.max(...workAreas.map((w) => w.height))
  const width = Math.min(Math.max(box.width, WINDOW_MIN_WIDTH), widest)
  const height = Math.min(Math.max(box.height, WINDOW_MIN_HEIGHT), tallest)
  let x = Math.round(box.x ?? 0)
  let y = Math.round(box.y ?? 0)

  // 挑交叠最大的一块屏当「家」
  let home = workAreas[0]
  let best = -1
  for (const wa of workAreas) {
    const area = intersectionArea({ x, y, width, height }, wa)
    if (area > best) {
      best = area
      home = wa
    }
  }
  // 在这块屏上几乎看不见了:拽回屏内,别让窗找不到
  const visibleW = Math.min(x + width, home.x + home.width) - Math.max(x, home.x)
  const visibleH = Math.min(y + height, home.y + home.height) - Math.max(y, home.y)
  if (visibleW < KEEP_VISIBLE_X || visibleH < KEEP_VISIBLE_Y) {
    return { x: home.x + REST_EDGE, y: home.y + REST_EDGE, width, height }
  }
  // 看得见但要保证至少露出一条边:x/y 夹进「留 120/80 可见」的范围
  x = Math.min(Math.max(x, home.x + KEEP_VISIBLE_X - width), home.x + home.width - KEEP_VISIBLE_X)
  y = Math.min(Math.max(y, home.y + KEEP_VISIBLE_Y - height), home.y + home.height - KEEP_VISIBLE_Y)
  return { x, y, width, height }
}

function stateFilePath(dir: string): string {
  return join(dir, 'window-state.json')
}

/** 读记事本;没记过/读不动/内容是垃圾,一律回 null(调用方走默认尺寸) */
export function readWindowState(dir: string): WindowState | null {
  return parseWindowState(readJsonFile(stateFilePath(dir)))
}

/** 写记事本;写不进去就算了 —— 记尺寸是锦上添花,不该惊动任何人 */
export function writeWindowState(dir: string, state: WindowState): void {
  writeJsonFile(stateFilePath(dir), state)
}
