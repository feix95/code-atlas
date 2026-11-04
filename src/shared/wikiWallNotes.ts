// 线索桌上用户自己贴的东西:彩色便签与图片。纯类型与纯函数,主进程存档清洗和渲染层摆放共用。
// 贴在卡上的便签记相对那张卡左上角的偏移,卡被拖走时跟着走;卡没了就回落到最后记下的绝对位置。

export const WALL_NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'orange'] as const
export type WallNoteColor = (typeof WALL_NOTE_COLORS)[number]

export const WALL_PHOTO_SIZES = ['s', 'm', 'l'] as const
export type WallPhotoSize = (typeof WALL_PHOTO_SIZES)[number]

/** 图片按大中小三档宽度摆,高度跟着图片比例走 */
export const WALL_PHOTO_WIDTH: Record<WallPhotoSize, number> = { s: 150, m: 220, l: 300 }
export const WALL_NOTE_W = 160
export const WALL_NOTE_H = 128
export const WALL_NOTE_TEXT_MAX = 500
export const WALL_CAPTION_MAX = 60
/** 单张图片上限 10MB,够放截图和手机照片 */
export const WALL_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const WALL_STICKERS_MAX = 300
/** 图片存档文件名只认应用自己起的「uuid.扩展名」,挡住路径穿越 */
export const WALL_IMAGE_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/

export interface WallAttach {
  pageId: string
  dx: number
  dy: number
  /** 用户手动选的关联:拖到空白处也不掉,只有点叉才取消;自动贴上的没有这个标记 */
  manual?: true
}

interface WallStickerBase {
  id: string
  /** 最后一次记下的绝对位置;贴在卡上时只在卡不见了时兜底 */
  x: number
  y: number
  z: number
  attach: WallAttach | null
}

export interface WallNote extends WallStickerBase {
  kind: 'note'
  color: WallNoteColor
  text: string
}

export interface WallPhoto extends WallStickerBase {
  kind: 'photo'
  file: string
  caption: string
  size: WallPhotoSize
  /** 高宽比,读到图片尺寸后记下,摆放与贴卡判定用 */
  ratio: number
}

export type WallSticker = WallNote | WallPhoto

export interface WallNotesFile {
  version: 1
  projectRoot: string
  stickers: WallSticker[]
}

const COORD_MAX = 50_000
const OFFSET_MAX = 20_000

function num(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.round(Math.min(max, Math.max(min, raw)))
}

function str(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.slice(0, max) : ''
}

function cleanAttach(raw: unknown): WallAttach | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { pageId, dx, dy } = raw as Record<string, unknown>
  if (typeof pageId !== 'string' || pageId === '' || pageId.length > 500) return null
  return {
    pageId,
    dx: num(dx, -OFFSET_MAX, OFFSET_MAX, 0),
    dy: num(dy, -OFFSET_MAX, OFFSET_MAX, 0),
    ...((raw as Record<string, unknown>).manual === true ? { manual: true as const } : {})
  }
}

function cleanSticker(raw: unknown): WallSticker | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !/^[\w-]{1,64}$/.test(r.id)) return null
  const base = {
    id: r.id,
    x: num(r.x, -COORD_MAX, COORD_MAX, 0),
    y: num(r.y, -COORD_MAX, COORD_MAX, 0),
    z: num(r.z, 0, 1_000_000, 0),
    attach: cleanAttach(r.attach)
  }
  if (r.kind === 'note') {
    const color = WALL_NOTE_COLORS.find((c) => c === r.color) ?? 'yellow'
    return { ...base, kind: 'note', color, text: str(r.text, WALL_NOTE_TEXT_MAX) }
  }
  if (r.kind === 'photo') {
    if (typeof r.file !== 'string' || !WALL_IMAGE_FILE_RE.test(r.file)) return null
    const size = WALL_PHOTO_SIZES.find((s) => s === r.size) ?? 'm'
    const ratio =
      typeof r.ratio === 'number' && Number.isFinite(r.ratio)
        ? Math.min(4, Math.max(0.25, r.ratio))
        : 0.75
    return {
      ...base,
      kind: 'photo',
      file: r.file,
      caption: str(r.caption, WALL_CAPTION_MAX),
      size,
      ratio
    }
  }
  return null
}

/** 坏条目逐条丢掉,不因一张坏便签整份作废;id 重复只留第一张 */
export function sanitizeWallStickers(raw: unknown): WallSticker[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: WallSticker[] = []
  for (const item of raw.slice(0, WALL_STICKERS_MAX)) {
    const sticker = cleanSticker(item)
    if (sticker === null || seen.has(sticker.id)) continue
    seen.add(sticker.id)
    out.push(sticker)
  }
  return out
}

export function wallStickerSize(sticker: WallSticker): { w: number; h: number } {
  if (sticker.kind === 'note') return { w: WALL_NOTE_W, h: WALL_NOTE_H }
  const w = WALL_PHOTO_WIDTH[sticker.size]
  // 照片底下留一行说明文字
  return { w, h: Math.round(w * sticker.ratio) + 34 }
}

export interface WallRect {
  x: number
  y: number
  w: number
  h: number
}

/** 便签这会儿该画在哪:贴着的卡还在就跟着卡,否则用自己的绝对位置 */
export function placeWallSticker(
  sticker: WallSticker,
  cards: ReadonlyMap<string, { x: number; y: number }>
): WallRect & { attachedTo: string | null } {
  const size = wallStickerSize(sticker)
  const host = sticker.attach === null ? undefined : cards.get(sticker.attach.pageId)
  if (sticker.attach !== null && host !== undefined) {
    return {
      x: host.x + sticker.attach.dx,
      y: host.y + sticker.attach.dy,
      ...size,
      attachedTo: sticker.attach.pageId
    }
  }
  return { x: sticker.x, y: sticker.y, ...size, attachedTo: null }
}

function overlapArea(a: WallRect, b: WallRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** 松手时便签要真的压到某张卡的边缘以内才贴上(不留外扩余量);同时压着几张时贴压得最多的那张 */
export const WALL_ATTACH_GAP = 0

export function wallAttachTarget(
  rect: WallRect,
  cards: ReadonlyArray<WallRect & { pageId: string }>
): WallAttach | null {
  let best: (WallRect & { pageId: string }) | null = null
  let bestArea = 0
  const g = WALL_ATTACH_GAP
  for (const card of cards) {
    const area = overlapArea(rect, {
      x: card.x - g,
      y: card.y - g,
      w: card.w + 2 * g,
      h: card.h + 2 * g
    })
    if (area > bestArea) {
      best = card
      bestArea = area
    }
  }
  if (best === null) return null
  return { pageId: best.pageId, dx: rect.x - best.x, dy: rect.y - best.y }
}

/** 拖完一张便签:记绝对位置、浮到最上面;挨着卡就自动贴那张。没挨着时,自动贴的就取下来,手动关联的保留 */
export function moveWallSticker(
  stickers: readonly WallSticker[],
  id: string,
  x: number,
  y: number,
  cards: ReadonlyArray<WallRect & { pageId: string }>
): WallSticker[] {
  const top = nextStickerZ(stickers)
  return stickers.map((sticker) => {
    if (sticker.id !== id) return sticker
    const rect = { x, y, ...wallStickerSize(sticker) }
    const old = sticker.attach
    const host = old?.manual === true ? cards.find((c) => c.pageId === old.pageId) : undefined
    const keep =
      host === undefined
        ? null
        : { pageId: host.pageId, dx: x - host.x, dy: y - host.y, manual: true as const }
    return { ...sticker, x, y, z: top, attach: wallAttachTarget(rect, cards) ?? keep }
  })
}

/** 手动关联到某张卡,或传 null 取消关联:便签都留在眼下看到的位置不动 */
export function linkWallSticker(
  stickers: readonly WallSticker[],
  id: string,
  pageId: string | null,
  cards: ReadonlyArray<WallRect & { pageId: string }>
): WallSticker[] {
  const byId = new Map(cards.map((c) => [c.pageId, c]))
  return stickers.map((sticker) => {
    if (sticker.id !== id) return sticker
    const at = placeWallSticker(sticker, byId)
    const card = pageId === null ? undefined : byId.get(pageId)
    const attach =
      card === undefined
        ? null
        : { pageId: card.pageId, dx: at.x - card.x, dy: at.y - card.y, manual: true as const }
    return { ...sticker, x: at.x, y: at.y, attach }
  })
}

export function nextStickerZ(stickers: readonly WallSticker[]): number {
  let top = 0
  for (const sticker of stickers) top = Math.max(top, sticker.z)
  return top + 1
}

/** 按叠放次序排好,渲染顺序即上下关系 */
export function sortWallStickers(stickers: readonly WallSticker[]): WallSticker[] {
  return [...stickers].sort((a, b) => a.z - b.z)
}

/** 认图片格式只看文件头,不信扩展名与 MIME */
export function sniffWallImage(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | 'webp' | null {
  const at = (i: number): number => bytes[i] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'gif'
  const tag = (from: number): string =>
    String.fromCharCode(at(from), at(from + 1), at(from + 2), at(from + 3))
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') return 'webp'
  return null
}

export type WallStickersLoadResult =
  { ok: true; stickers: WallSticker[] } | { ok: false; error: string }
export type WallStickersSaveResult = { ok: true } | { ok: false; error: string }
export type WallImageSaveResult = { ok: true; file: string } | { ok: false; error: string }
export type WallImageReadResult = { ok: true; url: string } | { ok: false; error: string }
