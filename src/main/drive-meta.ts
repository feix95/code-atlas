// ── 第八十一锤:盘符的来路;第八十二锤瘦身:卷标不上卡片 ──
// 盘卡片要能分清固定硬盘 / U 盘 / 网络盘。Win32 的 GetDriveType 没有 Node 直连的口子,
// 借 PowerShell 的 Get-CimInstance Win32_LogicalDisk 一次问齐;问不到(没有 PowerShell/
// 超时/输出是垃圾)就老实回空,盘卡片照旧叫「本地磁盘」,基本面不受影响。
// 卷标(ssd/software 这些用户起的名)起初也一起问过,小葵看了拍板:盘就认大写字母,
// 卷标不上卡片 —— 解析和查询都瘦身为只问类型。
// 带 5 秒小缓存:回首页重列盘符是高频动作,不必次次都起一个 PowerShell。

import { execFile } from 'node:child_process'
import type { DriveInfo } from '../shared/types.ts'

export type DriveKind = NonNullable<DriveInfo['kind']>

/** Win32 DriveType 数字 → 界面档位(纯函数,自测覆盖):2 可移动 / 3 固定 / 4 网络 / 5 光驱 */
export function driveKindFromNumber(n: unknown): DriveKind | undefined {
  if (n === 2) return 'removable'
  if (n === 3) return 'fixed'
  if (n === 4) return 'network'
  if (n === 5) return 'optical'
  return undefined
}

/** PowerShell 的 ConvertTo-Json 输出 → 按盘符归档的类型(纯函数,自测覆盖)。
 * 一个盘时 PowerShell 给裸对象,多个盘给数组;垃圾输入回 null;认不出类型的盘不进表。
 */
export function parseDriveKinds(raw: unknown): Map<string, DriveKind> | null {
  const list = Array.isArray(raw) ? raw : raw !== null && typeof raw === 'object' ? [raw] : []
  if (list.length === 0) return null
  const out = new Map<string, DriveKind>()
  for (const item of list) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const r = item as Record<string, unknown>
    if (typeof r['DeviceID'] !== 'string') continue
    const letter = r['DeviceID'].replace(/[^A-Za-z]/g, '').toUpperCase()
    if (letter.length !== 1) continue
    const kind = driveKindFromNumber(r['DriveType'])
    if (kind) out.set(letter, kind)
  }
  return out.size > 0 ? out : null
}

const META_TTL_MS = 5000
let metaCache: { at: number; kinds: Map<string, DriveKind> | null } | null = null

/** 问一轮盘符类型;失败、超时、垃圾输出一律回 null(调用方照旧只给盘符和容量) */
export async function queryDriveKinds(): Promise<Map<string, DriveKind> | null> {
  if (metaCache && Date.now() - metaCache.at < META_TTL_MS) return metaCache.kinds
  const kinds = await new Promise<Map<string, DriveKind> | null>((resolve) => {
    const command =
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType | ConvertTo-Json -Compress'
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: 4000, encoding: 'utf8', windowsHide: true },
      (err, stdout) => {
        if (err || typeof stdout !== 'string') return resolve(null)
        try {
          resolve(parseDriveKinds(JSON.parse(stdout.replace(/^\uFEFF/, ''))))
        } catch {
          resolve(null)
        }
      }
    )
  })
  metaCache = { at: Date.now(), kinds }
  return kinds
}
