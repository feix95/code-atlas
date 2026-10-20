// 机器探头(智能启动批次):为启动方案摸清机器规格 —— 内存、显卡名/厂商、显存总量与「此刻空闲」。
// 规矩:静态登记(内存/显卡名/显存总量)查一次缓存住;空闲显存每次现查(它一直在变)。
// 任何一步失败都不抛异常,查不到就给 null —— 启动方案宁可按内存算账也不许被探头绊倒。
import { execFile } from 'node:child_process'
import os from 'node:os'
import type { GpuVendor, MachineProfile } from '../shared/launchPlan.ts'

const CMD_TIMEOUT_MS = 15_000

/** nvidia-smi CSV 行 → 规格;"名, 总, 空闲" 三段;nounits 模式是裸数字,带单位的会跟 MiB,都接 */
export function parseNvidiaSmiProfile(
  line: string
): { gpuName: string; vramBytes: number; vramFreeBytes: number } | null {
  const m = line.trim().match(/^(.+?),\s*(\d+)(?:\s*MiB)?,\s*(\d+)(?:\s*MiB)?\s*$/)
  if (!m) return null
  const MiB = 1024 * 1024
  return { gpuName: m[1].trim(), vramBytes: Number(m[2]) * MiB, vramFreeBytes: Number(m[3]) * MiB }
}

/** 只看空闲那一段:"名, 总, 空闲" 或 "空闲" 单列都接得住(同样两种单位口径) */
export function parseNvidiaSmiFree(line: string): number | null {
  const t = line.trim()
  const full = parseNvidiaSmiProfile(t)
  if (full) return full.vramFreeBytes
  const m = t.match(/^(\d+)(?:\s*MiB)?\s*$/)
  return m ? Number(m[1]) * 1024 * 1024 : null
}

/** "算力, 驱动版本" CSV 行 → {computeCap, driverVersion};老 nvidia-smi 没这字段/行不合法都给 null */
export function parseNvidiaSmiCaps(line: string): {
  computeCap: number | null
  driverVersion: string | null
} {
  const m = line.trim().match(/^([0-9.]+)?\s*,\s*(.+?)\s*$/)
  if (!m) return { computeCap: null, driverVersion: null }
  const cap = m[1] ? Number(m[1]) : NaN
  return {
    computeCap: Number.isFinite(cap) ? cap : null,
    driverVersion: m[2]?.trim() || null
  }
}

/** 显卡名 → 厂商(WMI/CIM 查来的名字没有厂商字段,按名字里的记号认) */
export function vendorFromGpuName(name: string): GpuVendor {
  const n = name.toLowerCase()
  if (
    n.includes('nvidia') ||
    n.includes('geforce') ||
    n.includes('rtx') ||
    n.includes('gtx') ||
    n.includes('quadro') ||
    n.includes('tesla')
  )
    return 'nvidia'
  if (n.includes('amd') || n.includes('radeon')) return 'amd'
  if (n.includes('intel') || n.includes('arc ') || n.includes('iris') || n.includes('uhd'))
    return 'intel'
  return 'unknown'
}

function runCommand(
  file: string,
  args: string[]
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: CMD_TIMEOUT_MS }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

interface GpuStatic {
  gpuName: string | null
  gpuVendor: GpuVendor | null
  vramBytes: number | null
  /** N 卡算力(如 12.0);问不到/非 N 卡为 null */
  computeCap: number | null
  /** 显卡驱动版本;问不到为 null */
  driverVersion: string | null
  /** nvidia-smi 可用 —— 空闲显存每次都靠它现查 */
  nvidiaSmi: boolean
}

let gpuStaticCache: GpuStatic | undefined

/** 静态登记:先问 nvidia-smi(总量+名字一次拿),不认卡再退回 WMI 拿名字(显存问不到就老实给 null) */
async function probeGpuStatic(): Promise<GpuStatic> {
  const nv = await runCommand('nvidia-smi', [
    '--query-gpu=name,memory.total,memory.free',
    '--format=csv,noheader,nounits'
  ])
  if (nv.ok) {
    const parsed = parseNvidiaSmiProfile(nv.stdout.split('\n')[0] ?? '')
    if (parsed) {
      // 算力+驱动版本单独问一趟:老 nvidia-smi 没 compute_cap 字段,问砸了也不影响登记
      const caps = await runCommand('nvidia-smi', [
        '--query-gpu=compute_cap,driver_version',
        '--format=csv,noheader'
      ])
      const c = caps.ok ? parseNvidiaSmiCaps(caps.stdout.split('\n')[0] ?? '') : null
      return {
        gpuName: parsed.gpuName,
        gpuVendor: 'nvidia',
        vramBytes: parsed.vramBytes,
        computeCap: c?.computeCap ?? null,
        driverVersion: c?.driverVersion ?? null,
        nvidiaSmi: true
      }
    }
  }
  if (process.platform === 'win32') {
    const cim = await runCommand('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'
    ])
    if (cim.ok) {
      const name =
        cim.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)[0] ?? null
      if (name) {
        // CIM 的 AdapterRAM 在 >4GB 卡上会被截断,不可靠 —— 显存宁缺毋滥给 null
        return {
          gpuName: name,
          gpuVendor: vendorFromGpuName(name),
          vramBytes: null,
          computeCap: null,
          driverVersion: null,
          nvidiaSmi: false
        }
      }
    }
  }
  return {
    gpuName: null,
    gpuVendor: null,
    vramBytes: null,
    computeCap: null,
    driverVersion: null,
    nvidiaSmi: false
  }
}

/** 机器规格快照:内存现取,显卡登记用缓存,空闲显存每次现查;永不抛异常 */
export async function queryMachineProfile(): Promise<MachineProfile> {
  try {
    if (!gpuStaticCache) gpuStaticCache = await probeGpuStatic()
    const s = gpuStaticCache
    let vramFreeBytes: number | null = null
    if (s.nvidiaSmi) {
      const free = await runCommand('nvidia-smi', [
        '--query-gpu=memory.free',
        '--format=csv,noheader,nounits'
      ])
      if (free.ok) vramFreeBytes = parseNvidiaSmiFree(free.stdout.split('\n')[0] ?? '')
    }
    return {
      ramBytes: os.totalmem(),
      vramBytes: s.vramBytes,
      vramFreeBytes,
      gpuName: s.gpuName,
      gpuVendor: s.gpuVendor,
      gpuComputeCap: s.computeCap,
      driverVersion: s.driverVersion
    }
  } catch {
    return {
      ramBytes: os.totalmem(),
      vramBytes: null,
      vramFreeBytes: null,
      gpuName: null,
      gpuVendor: null,
      gpuComputeCap: null,
      driverVersion: null
    }
  }
}
