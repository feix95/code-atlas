// 盘符的人话读数:首页盘符卡、侧栏「这台电脑」列表共用一份(字段中心,别各写各的)
import type { DriveInfo } from '@shared/types'

/** 容量读数:字节换 GB,过百就不带小数,别啰嗦 */
export function driveCapacity(d: DriveInfo): string {
  if (!d.total) return '就绪'
  const gb = (n: number): string => `${(n / 1024 ** 3).toFixed(n / 1024 ** 3 >= 100 ? 0 : 1)} GB`
  return d.free !== undefined ? `剩 ${gb(d.free)} / 共 ${gb(d.total)}` : '就绪'
}

/** 盘的来路人话(第八十一锤):固定硬盘 / U 盘或移动硬盘 / 网络盘 / 光驱;问不到照旧叫本地磁盘 */
export function driveKindName(d: DriveInfo): string {
  if (d.kind === 'removable') return 'U 盘或移动硬盘'
  if (d.kind === 'network') return '网络盘'
  if (d.kind === 'optical') return '光驱'
  if (d.kind === 'fixed') return '固定硬盘'
  return '本地磁盘'
}
