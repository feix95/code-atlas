// 「这台电脑」刷新结果的人话摘要:对比刷新前后的盘符,把插拔说清楚。
import type { DriveInfo } from '@shared/types'

const toLabel = (d: DriveInfo): string => `${d.letter}:\\`

/** 盘符增减 → Toast 文案;没有变化也要明说,让人知道「刷新过了,结果就是没变」 */
export function describeDriveChange(prev: DriveInfo[] | null, next: DriveInfo[]): string {
  const before = new Set((prev ?? []).map((d) => d.letter))
  const after = new Set(next.map((d) => d.letter))
  const added = next.filter((d) => !before.has(d.letter)).map(toLabel)
  const removed = (prev ?? []).filter((d) => !after.has(d.letter)).map(toLabel)
  const parts: string[] = []
  if (added.length) parts.push(`新增 ${added.join('、')}`)
  if (removed.length) parts.push(`已移除 ${removed.join('、')}`)
  return parts.length ? `已刷新:${parts.join(',')}` : '已刷新,盘符没有变化'
}
