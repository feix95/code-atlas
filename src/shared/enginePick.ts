// 引擎挑哪颗:按机器规格给新手推荐最顺的后端,按用户选择与已装清单
// 定最终用哪颗。纯函数,机器探头喂进来的 MachineProfile + 已装名单 → 决定。
import {
  BACKEND_PREFERENCE,
  ENGINE_CATALOG,
  type EngineBackend,
  type EngineBackendChoice
} from './engineCatalog.ts'
import type { MachineProfile } from './launchPlan.ts'

/** CUDA 13.x 砍掉了 Maxwell/Pascal/Volta:算力低于 7.5 的 N 卡上不了 CUDA 引擎 */
const CUDA_MIN_COMPUTE_CAP = 7.5

export interface BackendRecommendation {
  backend: EngineBackend
  reason: string
}

/** 机器规格 → 最顺的后端(只看「理论上谁最快」,不看装没装) */
export function recommendBackend(machine: MachineProfile): BackendRecommendation {
  if (machine.gpuVendor === 'nvidia') {
    // 算力问得到才把关:老 nvidia-smi 查不出 compute_cap 时先信 CUDA(装完跑不动会退到 Vulkan)
    if (machine.gpuComputeCap == null || machine.gpuComputeCap >= CUDA_MIN_COMPUTE_CAP) {
      return { backend: 'cuda', reason: '认出了 N 卡,CUDA 引擎看图和出字都最快' }
    }
    return {
      backend: 'vulkan',
      reason: `这张 N 卡算力 ${machine.gpuComputeCap} 太老(CUDA 引擎要 7.5 以上),用 Vulkan 稳妥`
    }
  }
  if (machine.gpuVendor === 'amd' || machine.gpuVendor === 'intel') {
    return { backend: 'vulkan', reason: `${machine.gpuName ?? '这张显卡'}用 Vulkan 加速最稳妥` }
  }
  if (machine.gpuVendor === 'unknown' && machine.gpuName) {
    return { backend: 'vulkan', reason: '显卡型号没认全,Vulkan 兼容性最好' }
  }
  return { backend: 'cpu', reason: '没认出显卡,先用 CPU 兜底;之后认出显卡再换加速引擎' }
}

export type EngineUse =
  { kind: 'installed'; backend: EngineBackend } | { kind: 'vendor' } | { kind: 'none' }

export interface EngineResolution {
  /** 本轮该用哪颗引擎 */
  use: EngineUse
  /** 推荐但还没装的后端(界面据此挂「推荐安装」条);null = 没啥可推 */
  wantInstall: EngineBackend | null
  reason: string
}

/** 按优先级挑一颗已装的后端;没装任何后端回 null */
function bestInstalled(installed: Set<EngineBackend>): EngineBackend | null {
  for (const b of BACKEND_PREFERENCE) if (installed.has(b)) return b
  return null
}

/**
 * 用户选择 + 已装清单 → 用哪颗引擎。
 * 规矩:serverPath 自指程序路径的优先级不在这里管(调用方先问它,永远赢);
 * 用户显式点了没装的后端 → wantInstall 记它,本轮先按「能用的里最好的」顶上。
 */
export function resolveEngineChoice(input: {
  recommended: EngineBackend
  userChoice: EngineBackendChoice
  installed: Set<EngineBackend>
  vendorAvailable: boolean
}): EngineResolution {
  const { recommended, userChoice, installed, vendorAvailable } = input
  const fallback = (): EngineResolution => {
    const best = bestInstalled(installed)
    if (best) {
      return {
        use: { kind: 'installed', backend: best },
        wantInstall: null,
        reason: `先用已安装的${ENGINE_CATALOG[best].displayName}引擎`
      }
    }
    if (vendorAvailable) {
      return { use: { kind: 'vendor' }, wantInstall: null, reason: '先用应用自带的引擎' }
    }
    return { use: { kind: 'none' }, wantInstall: null, reason: '没有可用的引擎' }
  }

  const want = userChoice === 'auto' ? recommended : userChoice
  if (installed.has(want)) {
    const reason =
      userChoice === 'auto'
        ? `推荐:${ENGINE_CATALOG[want].displayName}`
        : `按你的选择:${ENGINE_CATALOG[want].displayName}`
    return { use: { kind: 'installed', backend: want }, wantInstall: null, reason }
  }
  // 想要的后端还没装:记成「推荐安装」的由头,本轮按能用的顶上
  const fb = fallback()
  return {
    ...fb,
    wantInstall: want,
    reason:
      userChoice === 'auto'
        ? `推荐安装${ENGINE_CATALOG[want].displayName}引擎;${fb.reason}`
        : `你选的${ENGINE_CATALOG[want].displayName}引擎还没安装;${fb.reason}`
  }
}
