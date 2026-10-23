// 机器规格:内存多大、显存多大(NVIDIA 卡能问到,问不到就 null,只按内存适配估算)。
import os from 'node:os'
import { runCommand } from './procCommand.ts'

/** 机器的规格:内存多大、显存多大(NVIDIA 卡能问到,问不到就 null,只按内存适配估算) */
export interface MachineSpec {
  ramBytes: number
  vramBytes: number | null
  gpuName: string | null
}

/** nvidia-smi 的一行输出 → 显卡名 + 显存字节(纯函数,自测覆盖);认不出回 null */
export function parseNvidiaSmi(line: string): { name: string; vramBytes: number } | null {
  // 形如 "NVIDIA GeForce RTX 5060 Ti, 16311 MiB"
  const hit = line.match(/^(.+?),\s*(\d+)\s*MiB\s*$/)
  if (!hit) return null
  const mib = Number(hit[2])
  if (!Number.isFinite(mib) || mib <= 0) return null
  return { name: hit[1].trim(), vramBytes: Math.round(mib * 1024 * 1024) }
}

let machineSpecCache: MachineSpec | undefined // undefined = 还没问过

/** 问一次机器规格(显存走 nvidia-smi,N/A 显卡老实回 null);同一进程只问一遍 */
export async function queryMachineSpec(): Promise<MachineSpec> {
  if (machineSpecCache !== undefined) return machineSpecCache
  const ramBytes = os.totalmem()
  let vramBytes: number | null = null
  let gpuName: string | null = null
  try {
    const out = await runCommand('nvidia-smi', [
      '--query-gpu=name,memory.total',
      '--format=csv,noheader'
    ])
    const hit = parseNvidiaSmi(out.split('\n')[0] ?? '')
    if (hit) {
      vramBytes = hit.vramBytes
      gpuName = hit.name
    }
  } catch {
    // 没装 N 卡或没这命令:不硬编显存,适配估算退回只看内存
  }
  const spec: MachineSpec = { ramBytes, vramBytes, gpuName }
  machineSpecCache = spec
  return spec
}
