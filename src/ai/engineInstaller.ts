// 引擎安装器:把 release 包下载 → 校验 sha256 → 解压 → 试跑 → 原子落位。
// 规矩:全靠 node 自带件(fetch/crypto/tar 命令),不加任何 npm 依赖;
// 下到一半的、校验不过的、取消的,都清进 .tmp 不留下半截引擎。
// 包的体检与解压归 enginePackage.ts;下载源可注入 fetchImpl(自测用本地文件喂,不碰网络)。
import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statfsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { findExtractedExe, runCommand, verifyAndExtract } from './enginePackage.ts'
import {
  backendTotalBytes,
  ENGINE_CATALOG,
  engineDirFor,
  engineExeFor,
  enginesRoot,
  type EngineBackend,
  type EngineInstallStage
} from '../shared/engineCatalog.ts'

const EXE_CHECK_TIMEOUT_MS = 15_000
/** 落盘需要的最小余量:包体本身 + 解压出来的成品,按 2.5 倍包体估 */
const DISK_HEADROOM = 2.5

export interface InstallProgress {
  backend: EngineBackend
  stage: EngineInstallStage
  /** 0-100;下载段按全部包的合计字节折算 */
  percent: number
  bytesDone?: number
  bytesTotal?: number
}

export type FetchImpl = (url: string, signal?: AbortSignal) => Promise<Response>

/** 下载段占总进度的比例;校验/解压/试跑分剩下的尾巴 */
const STAGE_PERCENT: Record<InstallProgress['stage'], number> = {
  download: 0, // 动态算
  verify: 92,
  extract: 96,
  check: 99,
  done: 100
}

/** 各包已下字节 → 下载段总进度(0-92,纯函数,自测覆盖) */
export function downloadPercent(sizes: number[], done: number[]): number {
  const total = sizes.reduce((s, n) => s + n, 0)
  if (total <= 0) return 0
  const got = done.reduce((s, n, i) => s + Math.min(Math.max(n, 0), sizes[i] ?? 0), 0)
  return Math.min(90, Math.floor((got / total) * 90))
}

function throwAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('已取消安装')
}

async function downloadOne(
  url: string,
  dest: string,
  expectedBytes: number,
  fetchImpl: FetchImpl,
  signal: AbortSignal | undefined,
  onBytes: (done: number) => void
): Promise<void> {
  const res = await fetchImpl(url, signal)
  if (!res.ok || !res.body) throw new Error(`下载失败(HTTP ${res.status}),请检查网络后重试`)
  const out = createWriteStream(dest)
  try {
    const reader = res.body.getReader()
    let done = 0
    for (;;) {
      throwAbort(signal)
      const { value, done: fin } = await reader.read()
      if (fin) break
      out.write(Buffer.from(value))
      done += value.byteLength
      onBytes(done)
    }
    await new Promise<void>((res2, rej) => {
      out.end(() => res2())
      out.on('error', rej)
    })
    if (done !== expectedBytes) {
      throw new Error(`下载不完整，收到 ${done} 字节，应为 ${expectedBytes} 字节，请重试`)
    }
  } finally {
    out.destroy()
  }
}

/** 试跑 llama-server --version:exit 0 且 15 秒内回话才算这颗引擎真能用 */
async function checkExeRuns(exePath: string): Promise<boolean> {
  return (await runCommand(exePath, ['--version'], EXE_CHECK_TIMEOUT_MS)).ok
}

/** 装到哪颗引擎了(engineState 给界面看);null = 没在装 */
let installing: {
  backend: EngineBackend
  percent: number
  stage: InstallProgress['stage']
} | null = null
export function installingNow(): typeof installing {
  return installing
}

const inFlight = new Map<EngineBackend, Promise<{ dir: string }>>()

/**
 * 装一颗引擎:磁盘体检 → 逐包下载到 .tmp → 校验 → 解压 → 试跑 → 原子改名落位。
 * 同一后端同时只装一份(并发调用挂同一个 Promise);signal 取消会清掉 .tmp。
 */
export async function installBackend(
  backend: EngineBackend,
  opts: {
    userDataDir: string
    onProgress?: (p: InstallProgress) => void
    signal?: AbortSignal
    fetchImpl?: FetchImpl
  }
): Promise<{ dir: string }> {
  const existing = inFlight.get(backend)
  if (existing) return existing
  const job = installBackendInner(backend, opts).finally(() => {
    inFlight.delete(backend)
    installing = null
  })
  inFlight.set(backend, job)
  return job
}

async function installBackendInner(
  backend: EngineBackend,
  opts: Parameters<typeof installBackend>[1]
): Promise<{ dir: string }> {
  const { userDataDir, onProgress, signal } = opts
  const fetchImpl: FetchImpl = opts.fetchImpl ?? ((url, sig) => fetch(url, { signal: sig }))
  const info = ENGINE_CATALOG[backend]
  const totalBytes = backendTotalBytes(backend)
  const tmpRoot = join(enginesRoot(userDataDir), '.tmp')
  const finalDir = engineDirFor(userDataDir, backend)
  const rand = randomBytes(4).toString('hex')
  const extractDir = join(tmpRoot, `${backend}-${rand}`)
  mkdirSync(tmpRoot, { recursive: true })
  const report = (stage: InstallProgress['stage'], done: number[] = []): void => {
    const percent =
      stage === 'download'
        ? downloadPercent(
            info.assets.map((a) => a.bytes),
            done
          )
        : STAGE_PERCENT[stage]
    installing = { backend, percent, stage }
    onProgress?.({
      backend,
      stage,
      percent,
      bytesDone: stage === 'download' ? done.reduce((s, n) => s + n, 0) : undefined,
      bytesTotal: stage === 'download' ? totalBytes : undefined
    })
  }
  try {
    throwAbort(signal)
    // 磁盘体检:下载 + 解压双份空间,不够先拦下,不下半截才发现
    const fsInfo = statfsSync(enginesRoot(userDataDir))
    const free = fsInfo.bfree * fsInfo.bsize
    if (free < totalBytes * DISK_HEADROOM) {
      throw new Error(
        `磁盘空间不足，需要约 ${Math.ceil((totalBytes * DISK_HEADROOM) / 1_000_000_000)} GB，请清理后重试`
      )
    }
    const doneBytes = new Array<number>(info.assets.length).fill(0)
    report('download', doneBytes)
    // 逐包下载+校验+解压进同一个临时目录(cuda 的 cudart 包跟主包合住一屋)
    for (let i = 0; i < info.assets.length; i++) {
      const a = info.assets[i]
      const part = join(tmpRoot, `${a.file}.part`)
      await downloadOne(a.url, part, a.bytes, fetchImpl, signal, (n) => {
        doneBytes[i] = n
        report('download', doneBytes)
      })
      throwAbort(signal)
      report('verify')
      await verifyAndExtract(part, { bytes: a.bytes, sha256: a.sha256 }, extractDir)
      rmSync(part, { force: true })
      report('extract')
      throwAbort(signal)
    }
    const exe = findExtractedExe(extractDir)
    if (!exe) throw new Error('安装包里没有 llama-server.exe，请反馈给开发者')
    report('check')
    if (!(await checkExeRuns(exe))) {
      throw new Error(
        backend === 'cuda'
          ? '这台机器无法运行 CUDA 引擎，驱动或运行库不匹配，请改用 Vulkan 或 CPU 引擎'
          : '引擎安装成功但无法运行，请反馈给开发者'
      )
    }
    // 原子落位:同卷 rename 一下就好;已有旧安装先清掉再让位
    mkdirSync(resolve(finalDir, '..'), { recursive: true })
    if (existsSync(finalDir)) rmSync(finalDir, { recursive: true, force: true })
    renameSync(extractDir, finalDir)
    // 发行包 exe 在根目录(spike 验过);万一包结构变了多套一层,照实报错不硬猜
    if (!existsSync(engineExeFor(userDataDir, backend))) {
      throw new Error('安装完成后找不到 llama-server.exe，请反馈给开发者')
    }
    report('done')
    return { dir: finalDir }
  } finally {
    // 不管成败:临时目录与 .part 一律清场,不留下半截引擎
    try {
      rmSync(extractDir, { recursive: true, force: true })
    } catch {
      /* 清理失败不抢戏的 */
    }
  }
}

/** 已安装的后端清单(以 llama-server.exe 真的在为准) */
export function listInstalled(userDataDir: string): EngineBackend[] {
  const out: EngineBackend[] = []
  for (const b of ['cuda', 'vulkan', 'cpu'] as const) {
    if (existsSync(engineExeFor(userDataDir, b))) out.push(b)
  }
  return out
}

/** 卸一颗引擎:整目录端走;正在装的时候不许卸(装完的目录还没落位也清不掉 .tmp 里的半成品,由取消管) */
export async function removeBackend(userDataDir: string, backend: EngineBackend): Promise<void> {
  if (inFlight.has(backend)) throw new Error('这颗引擎正在安装，请先取消安装再删除')
  rmSync(engineDirFor(userDataDir, backend), { recursive: true, force: true })
}

/** 开机扫一次:上次装到一半留下的 .tmp 全清(取消/崩溃的残局) */
export function cleanupStaleTmp(userDataDir: string): void {
  const tmp = join(enginesRoot(userDataDir), '.tmp')
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* 没这目录/清不掉都不碍事 */
  }
}

/** 给自测/排查用:把 resolve 后的目标目录摆出来看(防御性断言用) */
export function insideEngines(userDataDir: string, p: string): boolean {
  return resolve(p)
    .toLowerCase()
    .startsWith(resolve(enginesRoot(userDataDir)).toLowerCase())
}
