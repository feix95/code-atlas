// 画板本机偏好(纯逻辑):上次尺寸、最近使用(去重,上限 RECENT_SIZES_MAX)、用户命名预设。
// 存档反序列化时逐字段校验,坏字段丢弃、整体损坏回落默认。
// 日后有「方案文件」时,画板尺寸归方案所有,这里的 last 只作新方案的默认值。
import {
  ARTBOARD_SIDE_MAX,
  ARTBOARD_SIDE_MIN,
  DEFAULT_ARTBOARD,
  type ArtboardSize
} from './artboard.ts'

export interface SavedArtboardPreset extends ArtboardSize {
  id: string
  name: string
}

export interface ArtboardPrefs {
  last: ArtboardSize
  recent: ArtboardSize[]
  saved: SavedArtboardPreset[]
}

export const RECENT_SIZES_MAX = 5
export const PRESET_NAME_MAX = 32

export const DEFAULT_ARTBOARD_PREFS: ArtboardPrefs = {
  last: DEFAULT_ARTBOARD,
  recent: [],
  saved: []
}

export function isSameSize(a: ArtboardSize, b: ArtboardSize): boolean {
  return a.width === b.width && a.height === b.height
}

export function formatSize(size: ArtboardSize): string {
  return `${size.width} × ${size.height}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSide(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= ARTBOARD_SIDE_MIN &&
    (value as number) <= ARTBOARD_SIDE_MAX
  )
}

function toSize(value: unknown): ArtboardSize | null {
  if (!isRecord(value) || !isSide(value.width) || !isSide(value.height)) return null
  return { width: value.width, height: value.height }
}

function toSavedPreset(value: unknown): SavedArtboardPreset | null {
  const size = toSize(value)
  if (!size || !isRecord(value)) return null
  const { id, name } = value
  if (typeof id !== 'string' || id === '' || typeof name !== 'string' || name.trim() === '') {
    return null
  }
  return { ...size, id, name: name.trim().slice(0, PRESET_NAME_MAX) }
}

function compact<T>(items: unknown, convert: (item: unknown) => T | null): T[] {
  if (!Array.isArray(items)) return []
  return items.map(convert).filter((item): item is T => item !== null)
}

/** 已 JSON.parse 的存档 → 合法偏好;坏字段丢弃,last 不合法时回落默认尺寸 */
export function sanitizeArtboardPrefs(value: unknown): ArtboardPrefs {
  if (!isRecord(value)) return DEFAULT_ARTBOARD_PREFS
  const recent = compact(value.recent, toSize).filter(
    (size, index, all) => all.findIndex((other) => isSameSize(other, size)) === index
  )
  return {
    last: toSize(value.last) ?? DEFAULT_ARTBOARD,
    recent: recent.slice(0, RECENT_SIZES_MAX),
    saved: compact(value.saved, toSavedPreset)
  }
}

/** 用了一个尺寸:记为上次尺寸,并顶到最近使用最前(去重、截断) */
export function recordArtboardSize(prefs: ArtboardPrefs, size: ArtboardSize): ArtboardPrefs {
  const recent = [size, ...prefs.recent.filter((other) => !isSameSize(other, size))]
  return { ...prefs, last: size, recent: recent.slice(0, RECENT_SIZES_MAX) }
}

/** 预设名:去首尾空白、截断;留空则以尺寸命名 */
export function normalizePresetName(raw: string, size: ArtboardSize): string {
  return raw.trim().slice(0, PRESET_NAME_MAX) || formatSize(size)
}

/** 存为预设:同名覆盖原位(沿用原 id),否则追加到末尾 */
export function saveArtboardPreset(
  prefs: ArtboardPrefs,
  preset: SavedArtboardPreset
): ArtboardPrefs {
  const index = prefs.saved.findIndex((p) => p.name === preset.name)
  if (index < 0) return { ...prefs, saved: [...prefs.saved, preset] }
  const saved = prefs.saved.map((p, i) => (i === index ? { ...preset, id: p.id } : p))
  return { ...prefs, saved }
}

export function removeArtboardPreset(prefs: ArtboardPrefs, id: string): ArtboardPrefs {
  return { ...prefs, saved: prefs.saved.filter((p) => p.id !== id) }
}
