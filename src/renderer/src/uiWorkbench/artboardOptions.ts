// 画板尺寸下拉的选项表(纯逻辑):最近使用 → 我的预设 → 内置预设(按设备分组);
// 选项值带来源前缀,当前尺寸回选规则见 MATCH_PRIORITY。
import { ARTBOARD_PRESETS, type ArtboardSize } from '../../../shared/uiWorkbench/artboard.ts'
import {
  formatSize,
  isSameSize,
  type ArtboardPrefs
} from '../../../shared/uiWorkbench/artboardPrefs.ts'

export type ArtboardOptionSource = 'recent' | 'saved' | 'builtin'

export interface ArtboardOption {
  value: string
  label: string
  size: ArtboardSize
  source: ArtboardOptionSource
  /** 我的预设的 id,删除用 */
  savedId?: string
}

export interface ArtboardOptionGroup {
  label: string
  options: ArtboardOption[]
}

export const CUSTOM_OPTION = 'custom'

/** 回选优先级:预设先精确匹配,再按对调方向匹配(横竖屏切换后仍停在原预设),最后才是最近使用 */
const MATCH_PRIORITY: readonly { source: ArtboardOptionSource; isRotated: boolean }[] = [
  { source: 'saved', isRotated: false },
  { source: 'builtin', isRotated: false },
  { source: 'saved', isRotated: true },
  { source: 'builtin', isRotated: true },
  { source: 'recent', isRotated: false }
]

function builtinGroups(): ArtboardOptionGroup[] {
  const groups = [...new Set(ARTBOARD_PRESETS.map((p) => p.group))]
  return groups.map((group) => ({
    label: group,
    options: ARTBOARD_PRESETS.filter((p) => p.group === group).map((p) => ({
      value: `builtin:${p.id}`,
      label: `${p.label} ${formatSize(p)}`,
      size: { width: p.width, height: p.height },
      source: 'builtin' as const
    }))
  }))
}

export function buildArtboardOptionGroups(prefs: ArtboardPrefs): ArtboardOptionGroup[] {
  const recent: ArtboardOption[] = prefs.recent.map((size) => ({
    value: `recent:${formatSize(size)}`,
    label: formatSize(size),
    size,
    source: 'recent'
  }))
  const saved: ArtboardOption[] = prefs.saved.map((p) => ({
    value: `saved:${p.id}`,
    label: `${p.name} ${formatSize(p)}`,
    size: { width: p.width, height: p.height },
    source: 'saved',
    savedId: p.id
  }))
  return [
    { label: '最近使用', options: recent },
    { label: '我的预设', options: saved },
    ...builtinGroups()
  ].filter((group) => group.options.length > 0)
}

export function findArtboardOption(
  groups: ArtboardOptionGroup[],
  value: string
): ArtboardOption | null {
  return groups.flatMap((g) => g.options).find((o) => o.value === value) ?? null
}

/** 当前尺寸对应的选项;都对不上返回 null(显示为自定义) */
export function matchArtboardOption(
  groups: ArtboardOptionGroup[],
  board: ArtboardSize
): ArtboardOption | null {
  const options = groups.flatMap((g) => g.options)
  const rotated = { width: board.height, height: board.width }
  for (const { source, isRotated } of MATCH_PRIORITY) {
    const target = isRotated ? rotated : board
    const hit = options.find((o) => o.source === source && isSameSize(o.size, target))
    if (hit) return hit
  }
  return null
}
