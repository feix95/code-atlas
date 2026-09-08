// ── 第八十一锤:盘符的卷标和来路 ──
// 「这台电脑」页的盘卡片要说真话:这盘叫什么(卷标)、是固定硬盘还是 U 盘还是网络盘。
// Win32 的 GetVolumeInformation/GetDriveType 没有 Node 直连的口子,借 PowerShell 的
// Get-CimInstance Win32_LogicalDisk 一次问齐;问不到(没有 PowerShell/超时/输出是垃圾)
// 就老实回空,盘卡片回退按老样子叫「本地磁盘」,基本面不受影响。
// 带 5 秒小缓存:回首页重列盘符是高频动作,不必次次都起一个 PowerShell。

import { execFile } from 'node:child_process'
import type { DriveInfo } from '../shared/types.ts'

export type DriveKind = NonNullable<DriveInfo['kind']>

export interface DriveMetaEntry {
  label?: string
  kind?: DriveKind
}

/** Win32 DriveType 数字 → 界面档位(纯函数,自测覆盖):2 可移动 / 3 固定 / 4 网络 / 5 光驱 */
export function driveKindFromNumber(n: unknown): DriveKind | undefined {
  if (n === 2) return 'removable'
  if (n === 3) return 'fixed'
  if (n === 4) return 'network'
  if (n === 5) return 'optical'
  return undefined
}

/** PowerShell 的 ConvertTo-Json 输出 → 按盘符归档的元数据(纯函数,自测覆盖)。
 * 一个盘时 PowerShell 给裸对象,多个盘给数组;垃圾输入回 null。
 */
export function parseDriveMeta(raw: unknown): Map<string, DriveMetaEntry> | null {
  const list = Array.isArray(raw) ? raw : raw !== null && typeof raw === 'object' ? [raw] : []
  if (list.length === 0) return null
  const out = new Map<string, DriveMetaEntry>()
  for (const item of list) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const r = item as Record<string, unknown>
    if (typeof r['DeviceID'] !== 'string') continue
    const letter = r['DeviceID'].replace(/[^A-Za-z]/g, '').toUpperCase()
    if (letter.length !== 1) continue
    const entry: DriveMetaEntry = {}
    if (typeof r['VolumeName'] === 'string' && r['VolumeName'].trim() !== '') entry.label = r['VolumeName'].trim()
    const kind = driveKindFromNumber(r['DriveType'])
    if (kind) entry.kind = kind
    out.set(letter, entry)
  }
  return out.size > 0 ? out : null
}

const META_TTL_MS = 5000
let metaCache: { at: number; meta: Map<string, DriveMetaEntry> | null } | null = null

/** 问一轮卷标/来路;失败、超时、垃圾输出一律回 null(调用方照常只给盘符和容量) */
export async function queryDriveMeta(): Promise<Map<string, DriveMetaEntry> | null> {
  if (metaCache && Date.now() - metaCache.at < META_TTL_MS) return metaCache.meta
  const meta = await new Promise<Map<string, DriveMetaEntry> | null>((resolve) => {
    const command =
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json -Compress'
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: 4000, encoding: 'utf8', windowsHide: true },
      (err, stdout) => {
        if (err || typeof stdout !== 'string') return resolve(null)
        try {
          resolve(parseDriveMeta(JSON.parse(stdout.replace(/^\uFEFF/, ''))))
        } catch {
          resolve(null)
        }
      }
    )
  })
  metaCache = { at: Date.now(), meta }
  return meta
}
