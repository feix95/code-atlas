// 引擎定位(第 4 期):「这次该用哪颗 llama-server」收成一个决定 ——
// 用户自指路径 > 已装引擎(按选择/推荐)> 应用自带 vendor。
// 顺手产出 fallback 链(安装引擎起不来时退到哪颗)与展示标签/版本号。
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AiBuiltinSettings } from '../shared/types.ts'
import {
  BACKEND_PREFERENCE,
  ENGINE_CATALOG,
  engineExeFor,
  ENGINE_TAG,
  sanitizeBackendChoice,
  type EngineBackend
} from '../shared/engineCatalog.ts'
import { recommendBackend, resolveEngineChoice } from '../shared/enginePick.ts'
import { queryMachineProfile } from './machineProbe.ts'
import { listInstalled } from './engineInstaller.ts'

const VERSION_TIMEOUT_MS = 15_000

export type EngineKind = 'custom' | 'installed' | 'vendor'

export interface LocatedEngine {
  /** 本轮要 spawn 的 exe 绝对路径;null = 没有任何引擎可用 */
  exePath: string | null
  kind: EngineKind | 'none'
  /** kind=installed 时是哪颗后端 */
  backend: EngineBackend | null
  /** 展示标签:devlog 启动行与界面共用('CUDA 加速 · b11685'/'自带引擎'/'自指引擎') */
  label: string
  /** 推荐但还没装的后端(挂「推荐安装」条用) */
  wantInstall: EngineBackend | null
  recommended: EngineBackend | null
  /** 起不来的话下一步退到哪颗(仅 installed 引擎给;vendor/custom 没有退路) */
  fallbackExe: string | null
  fallbackLabel: string | null
}

/** vendor 自带引擎的候选位置(dev = 项目根 vendor/,打包 = resources/)—— resolveServerProgram 同口径 */
export function vendorExeCandidates(): string[] {
  const candidates: string[] = [join(process.cwd(), 'vendor', 'llama-cpp', 'llama-server.exe')]
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  if (typeof resourcesPath === 'string') {
    candidates.push(join(resourcesPath, 'llama-cpp', 'llama-server.exe'))
  }
  return candidates
}

export function vendorExePath(): string | null {
  return vendorExeCandidates().find((p) => existsSync(p)) ?? null
}

/** 引擎 --version 第一行(按 exe 路径缓存;换 exe 才重查) */
const versionCache = new Map<string, Promise<string | null>>()

export function engineVersionFor(exePath: string): Promise<string | null> {
  const hit = versionCache.get(exePath)
  if (hit) return hit
  const job = new Promise<string | null>((res) => {
    execFile(
      exePath,
      ['--version'],
      { timeout: VERSION_TIMEOUT_MS, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return res(null)
        const line = `${stdout ?? ''}${stderr ?? ''}`
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)[0]
        res(line ?? null)
      }
    )
  })
  versionCache.set(exePath, job)
  return job
}

/**
 * 定本轮引擎:自指路径(高级用法)永远赢;不然按「选择 + 已装 + 推荐」定一颗。
 * userDataDir 传空串 = 还没初始化(自测),按「什么都没装」算。
 */
export async function locateEngine(
  settings: AiBuiltinSettings,
  userDataDir: string
): Promise<LocatedEngine> {
  const configured = settings.serverPath.trim()
  if (configured) {
    // 跟 resolveServerProgram 同一口径:指了就得在,不在就拦下让人重选
    if (!existsSync(configured)) {
      throw new Error('找不到 llama-server 程序:去「AI 设置」重新选一下程序路径')
    }
    return {
      exePath: configured,
      kind: 'custom',
      backend: null,
      label: '自指引擎',
      wantInstall: null,
      recommended: null,
      fallbackExe: null,
      fallbackLabel: null
    }
  }

  const installed = userDataDir ? listInstalled(userDataDir) : []
  const machine = await queryMachineProfile()
  const rec = recommendBackend(machine)
  const vendor = vendorExePath()
  const resolution = resolveEngineChoice({
    recommended: rec.backend,
    userChoice: sanitizeBackendChoice(settings.backend),
    installed: new Set(installed),
    vendorAvailable: vendor !== null
  })

  if (resolution.use.kind === 'installed') {
    const backend = resolution.use.backend
    const exePath = engineExeFor(userDataDir, backend)
    // 保险丝退路:优先级链上「下一颗已装的」,最后兜底 vendor
    let fallbackExe: string | null = null
    let fallbackLabel: string | null = null
    const order = BACKEND_PREFERENCE.slice(BACKEND_PREFERENCE.indexOf(backend) + 1)
    for (const b of order) {
      if (installed.includes(b)) {
        fallbackExe = engineExeFor(userDataDir, b)
        fallbackLabel = `${ENGINE_CATALOG[b].displayName} · ${ENGINE_TAG}`
        break
      }
    }
    if (!fallbackExe && vendor) {
      fallbackExe = vendor
      fallbackLabel = '自带引擎'
    }
    return {
      exePath,
      kind: 'installed',
      backend,
      label: `${ENGINE_CATALOG[backend].displayName} · ${ENGINE_TAG}`,
      wantInstall: resolution.wantInstall,
      recommended: rec.backend,
      fallbackExe,
      fallbackLabel
    }
  }
  if (resolution.use.kind === 'vendor' && vendor) {
    return {
      exePath: vendor,
      kind: 'vendor',
      backend: null,
      label: '自带引擎',
      wantInstall: resolution.wantInstall,
      recommended: rec.backend,
      fallbackExe: null,
      fallbackLabel: null
    }
  }
  return {
    exePath: null,
    kind: 'none',
    backend: null,
    label: '没有可用引擎',
    wantInstall: resolution.wantInstall,
    recommended: rec.backend,
    fallbackExe: null,
    fallbackLabel: null
  }
}
