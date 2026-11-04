// 线索桌上手动摆放的位置:纯函数,负责清洗存档、把手摆位置盖到自动布局上、重挂线绳。
// 存档只记被手动拖过的卡:没拖过的卡继续跟自动布局走,重新生成 Wiki 后新卡也能自然落位。
import {
  WALL_PAD,
  placeWallLinks,
  type WallPlacedCard,
  type WikiWallLayout
} from './wikiWallLayout.ts'
import type { WikiWallLink } from '../../shared/wikiTypes'

export interface WallPos {
  x: number
  y: number
  /** 叠放次序:越大越靠上,拖过的卡浮到最上面 */
  z: number
}

export type WallPositions = Readonly<Record<string, WallPos>>
/** 按项目根路径分开存 */
export type WallBoardPrefs = Readonly<Record<string, WallPositions>>

/** 坐标上限:防止坏存档把卡扔到几百万像素外,板面撑爆 */
const COORD_MAX = 50_000
const MAX_PROJECTS = 200
const MAX_CARDS = 3000

function cleanPos(raw: unknown): WallPos | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { x, y, z } = raw as Record<string, unknown>
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null
  }
  const clamp = (n: number): number => Math.round(Math.min(COORD_MAX, Math.max(0, n)))
  return {
    x: clamp(x),
    y: clamp(y),
    z: typeof z === 'number' && Number.isFinite(z) ? Math.round(z) : 0
  }
}

export function sanitizeWallPositions(raw: unknown): WallPositions {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, WallPos> = {}
  for (const [id, value] of Object.entries(raw).slice(0, MAX_CARDS)) {
    if (id === '' || id.length > 500) continue
    const pos = cleanPos(value)
    if (pos !== null) out[id] = pos
  }
  return out
}

export function sanitizeWallBoardPrefs(raw: unknown): WallBoardPrefs {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, WallPositions> = {}
  for (const [root, value] of Object.entries(raw).slice(0, MAX_PROJECTS)) {
    if (root === '' || root.length > 2048) continue
    const positions = sanitizeWallPositions(value)
    if (Object.keys(positions).length > 0) out[root] = positions
  }
  return out
}

/** 下一张被拖动的卡该用的叠放次序 */
export function nextWallZ(positions: WallPositions): number {
  let top = 0
  for (const pos of Object.values(positions)) top = Math.max(top, pos.z)
  return top + 1
}

/**
 * 把手摆位置盖到自动布局上:位置、图钉跟着挪,线绳重挂,板面按最远的卡撑大。
 * 返回的卡片按叠放次序排好(没拖过的在下面),渲染顺序即上下关系。
 */
export function applyWallPositions(
  layout: WikiWallLayout,
  positions: WallPositions,
  links: WikiWallLink[]
): WikiWallLayout {
  if (Object.keys(positions).length === 0) return layout
  const placed = new Map<string, WallPlacedCard>()
  const zOf = new Map<string, number>()
  let width = layout.width
  let height = layout.height
  for (const card of layout.cards) {
    const pos = positions[card.card.pageId]
    if (pos === undefined) {
      placed.set(card.card.pageId, card)
      zOf.set(card.card.pageId, 0)
      continue
    }
    const moved = { ...card, x: pos.x, y: pos.y, pinX: pos.x + card.w / 2, pinY: pos.y + 4 }
    placed.set(card.card.pageId, moved)
    zOf.set(card.card.pageId, pos.z)
    width = Math.max(width, pos.x + card.w + WALL_PAD)
    height = Math.max(height, pos.y + card.h + WALL_PAD)
  }
  const cards = [...placed.values()].sort(
    (a, b) => (zOf.get(a.card.pageId) ?? 0) - (zOf.get(b.card.pageId) ?? 0)
  )
  return { ...layout, cards, links: placeWallLinks(placed, links), width, height }
}
