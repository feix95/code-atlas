/**
 * 智能启动方案(模型启动规划批次):给定机器规格 + 模型登记,算出 llama-server 的启动参数。
 * 规矩来自真机实测(RTX 5060 Ti 16GB + Gemma-4-26B MoE):
 *   - 显卡摆层一律交给引擎内置的 --fit 自动安排;硬塞 -ngl 999 会关掉自动摆层,
 *     Vulkan 后端在分配视觉投影仪缓冲时当场 OOM 崩掉(ErrorOutOfDeviceMemory)。
 *   - 装不下就按梯子降档:①视觉文件放内存 → ②KV 黑板改 q8_0 + 开 flash-attn → ③上下文砍半。
 *   - --n-cpu-moe 99 手动全放内存实测慢 3~4 倍,绝不自动选。
 * 纯状态表:不碰文件/进程/Electron,I/O 一律在 src/ai 侧。
 */
import type { GgufShape } from './types.ts'
import type { ModelLaunchSettings } from './launchSettings.ts'
import { estimateKvBytes, formatGB, kvBytesFromShape } from './contextBill.ts'
import { MODEL_FIT_RAM_MAX_RATIO, MODEL_FIT_RAM_OK_RATIO } from './modelShelf.ts'
import { normalizeContextSize } from './aiDefaults.ts'

const GB = 1024 ** 3

/** 显存预算:空闲显存(问不到就用总量)的 92% 能给模型/黑板/投影仪,余量留给桌面和瞬时尖峰 */
const VRAM_BUDGET_RATIO = 0.92
/** 显卡上除了权重和黑板,还要留一份算力缓冲(实测 mmproj 缓冲/工作区约吃掉 0.5GB) */
const COMPUTE_RESERVE_BYTES = 0.6 * GB
/** KV 从 f16 压到 q8_0 实测约省一半(0.53x) */
const KV_Q8_RATIO = 0.53
/** MoE 的专家能被 --fit 挪进内存:模型+黑板允许超显存预算,但内存最多再匀一半给它 */
const MOE_HOST_SHARE = 0.5
/** 投影仪放显卡时实测约多占 10%(mtmd 估计的 worst-case 再加一点) */
const MMPROJ_GPU_OVERHEAD = 1.1
/** 上下文再省也不能跌破这档,再低就真没法聊长材料了 */
const MIN_PLANNED_CONTEXT = 8192

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'unknown'

/** 机器规格:机器探头(machineProbe)查出来喂给规划器 */
export interface MachineProfile {
  ramBytes: number
  /** 显存总量;没认出显卡为 null */
  vramBytes: number | null
  /** 此刻空闲显存;问不到为 null */
  vramFreeBytes: number | null
  gpuName: string | null
  gpuVendor: GpuVendor | null
  /** NVIDIA 计算能力(如 12.0);问不到/非 N 卡为 null —— CUDA 版引擎挑机器的尺 */
  gpuComputeCap?: number | null
  /** 显卡驱动版本号;问不到为 null */
  driverVersion?: string | null
}

export interface LaunchParams {
  /** 'auto' = 不出 -ngl,交给引擎 --fit 自动摆层;具体数字才发 -ngl N */
  gpuLayers: 'auto' | number
  contextSize: number
  kvCache: 'f16' | 'q8_0'
  flashAttn: 'auto' | 'on'
  /** true = 投影仪进显卡(默认);false = 发 --no-mmproj-offload 放内存 */
  mmprojOffload: boolean
}

/** 用户手动指定的参数(第三期喂);指定了的字段原样照用,梯子不许碰 */
export type LaunchOverrides = Partial<LaunchParams>

export interface LaunchPlan {
  params: LaunchParams
  /** 只含方案参数(-c/-ngl/…);-m/--port/--host/--jinja/--mmproj 由启动器自己拼 */
  args: string[]
  /** 停下的梯子档:0 = 默认就装得下,越大省得越狠 */
  rung: number
  /** 每条一条人话:为什么这么配/妥协了什么 */
  reasons: string[]
  estimate: {
    /** 预计占显存;没认出显卡为 null */
    vramBytes: number | null
    /** 预计占内存(装不下时外溢到内存的部分;纯内存机型 = 全量) */
    ramBytes: number
    verdict: 'ok' | 'tight' | 'too-big'
  }
  /** 这轮启动带不带视觉文件 */
  mmprojUsed: boolean
}

export interface LaunchPlanInput {
  machine: MachineProfile
  modelBytes: number
  mmprojBytes: number | null
  shape: GgufShape | null
  /** 用户要的上下文(设置页里那档,已被 normalizeContextSize 归过) */
  requestedContext: number
  overrides?: LaunchOverrides
}

/** 设置卡「本机运行方案」一次端齐的报单(atlas:ai-launch-plan 的返回) */
export interface LaunchPlanInfo {
  machine: MachineProfile
  modelName: string | null
  modelBytes: number | null
  isMoe: boolean
  mmprojFile: string | null
  plan: LaunchPlan | null
  /** 全自动档的对照参数:高级面板里「自动，当前推荐 …」照它写 */
  autoParams: LaunchParams | null
  /** 这个模型已存的高级启动账(没有 = null,全自动) */
  saved: ModelLaunchSettings | null
  /** 本轮生效的专家参数(解析后的数组;没给/非法 = null) */
  extraArgs: string[] | null
  /** 当前会用的引擎(后端 + 标签 + --version 首行);查不到为 null */
  activeEngine: {
    kind: 'custom' | 'installed' | 'vendor' | 'none'
    backend: string | null
    label: string
    version: string | null
  } | null
}

/** KV 黑板估算:有结构档案精算,没档案按块头粗估;q8_0 约省一半 */
function kvEstimate(
  ctx: number,
  kvCache: 'f16' | 'q8_0',
  shape: GgufShape | null,
  modelBytes: number
): number {
  const exact = shape ? kvBytesFromShape(ctx, shape) : null
  const f16 = exact ?? estimateKvBytes(ctx, modelBytes)
  return kvCache === 'q8_0' ? Math.round(f16 * KV_Q8_RATIO) : f16
}

interface FitCheck {
  /** 显卡侧总需求(模型 + 投影仪 + 黑板 + 算力缓冲) */
  needBytes: number
  /** 显存预算 */
  budgetBytes: number
  kvBytes: number
  verdict: 'ok' | 'tight' | 'too-big'
}

/** 显存口径的装得下判断;MoE 超预算但内存匀得开 → tight(专家挪内存,慢一点但跑得起) */
function fitCheck(input: LaunchPlanInput, params: LaunchParams): FitCheck {
  const m = input.machine
  const budgetBytes = (m.vramFreeBytes ?? m.vramBytes ?? 0) * VRAM_BUDGET_RATIO
  const kvBytes = kvEstimate(params.contextSize, params.kvCache, input.shape, input.modelBytes)
  const mmprojGpuBytes =
    params.mmprojOffload && input.mmprojBytes != null ? input.mmprojBytes * MMPROJ_GPU_OVERHEAD : 0
  const needBytes = input.modelBytes + mmprojGpuBytes + kvBytes + COMPUTE_RESERVE_BYTES
  const isMoe = (input.shape?.expertCount ?? 0) > 1
  let verdict: FitCheck['verdict'] = 'too-big'
  if (needBytes <= budgetBytes) {
    verdict = 'ok'
  } else if (isMoe && input.modelBytes + kvBytes <= budgetBytes + m.ramBytes * MOE_HOST_SHARE) {
    verdict = 'tight'
  }
  return { needBytes, budgetBytes, kvBytes, verdict }
}

/** 无卡口径:全量走内存;<=内存一半算稳,<=七成算挤,再多装不下 */
function fitCheckRam(input: LaunchPlanInput, params: LaunchParams): 'ok' | 'tight' | 'too-big' {
  const kv = kvEstimate(params.contextSize, params.kvCache, input.shape, input.modelBytes)
  const need = input.modelBytes + (input.mmprojBytes ?? 0) + kv
  const budget = input.machine.ramBytes * MODEL_FIT_RAM_MAX_RATIO
  if (need <= input.machine.ramBytes * MODEL_FIT_RAM_OK_RATIO) return 'ok'
  if (need <= budget) return 'tight'
  return 'too-big'
}

/** 方案参数 → llama-server 参数串;auto 层数绝不出 -ngl(--fit 靠缺省生效) */
function buildArgs(params: LaunchParams, mmprojUsed: boolean): string[] {
  const args = ['-c', String(params.contextSize)]
  if (params.gpuLayers !== 'auto') args.push('-ngl', String(params.gpuLayers))
  if (!params.mmprojOffload && mmprojUsed) args.push('--no-mmproj-offload')
  if (params.kvCache === 'q8_0') args.push('-ctk', 'q8_0', '-ctv', 'q8_0')
  if (params.flashAttn === 'on') args.push('-fa', 'on')
  return args
}

export function planLaunch(input: LaunchPlanInput): LaunchPlan {
  const ov = input.overrides ?? {}
  const m = input.machine
  const mmprojUsed = input.mmprojBytes != null
  const isMoe = (input.shape?.expertCount ?? 0) > 1
  const reasons: string[] = []

  // 机器行:只报显存预算(显卡名与总量已由方案卡上方的机器行显示,不复述)
  if (m.gpuName || m.gpuVendor === 'nvidia' || m.gpuVendor === 'amd' || m.gpuVendor === 'intel') {
    const budget = (m.vramFreeBytes ?? m.vramBytes ?? 0) * VRAM_BUDGET_RATIO
    reasons.push(`可分配给模型的显存预算 ${formatGB(budget)}`)
  } else {
    reasons.push('没认出显卡，模型将在内存中运行')
  }

  const hasGpu = m.vramBytes != null

  if (!hasGpu) {
    // 没认出显卡:梯子无意义(显存账算不出),按默认档 + 内存口径出结论
    const params = applyOverrides(
      {
        gpuLayers: 'auto',
        contextSize: input.requestedContext,
        kvCache: 'f16',
        flashAttn: 'auto',
        mmprojOffload: true
      },
      ov
    )
    const verdict = fitCheckRam(input, params)
    reasons.push(verdictLine('ram', verdict, 0, 0))
    return {
      params,
      args: buildArgs(params, mmprojUsed),
      rung: 0,
      reasons,
      estimate: {
        vramBytes: null,
        ramBytes:
          input.modelBytes +
          (input.mmprojBytes ?? 0) +
          kvEstimate(params.contextSize, params.kvCache, input.shape, input.modelBytes),
        verdict
      },
      mmprojUsed
    }
  }

  // 梯子四级,逐级更省;每一级只碰「没被手动指定的」字段
  const base: LaunchParams = {
    gpuLayers: 'auto',
    contextSize: input.requestedContext,
    kvCache: 'f16',
    flashAttn: 'auto',
    mmprojOffload: true
  }
  // 四级固定排布:rung 编号 = 梯子深度;没带投影仪时 rung1 与 rung0 参数相同,
  // 评估结果一样自然往下降,不算白走
  const rungs: LaunchParams[] = [base, { ...base, mmprojOffload: false }]
  const afterKv: LaunchParams = { ...rungs[1], kvCache: 'q8_0', flashAttn: 'on' }
  rungs.push(afterKv)
  if (input.requestedContext > MIN_PLANNED_CONTEXT) {
    rungs.push({
      ...afterKv,
      contextSize: Math.max(MIN_PLANNED_CONTEXT, Math.floor(input.requestedContext / 2))
    })
  }

  // 全字段被手动指定:梯子原地解散,直接评估
  const allOverridden =
    ov.gpuLayers !== undefined &&
    ov.contextSize !== undefined &&
    ov.kvCache !== undefined &&
    ov.flashAttn !== undefined &&
    ov.mmprojOffload !== undefined

  let params = applyOverrides(rungs[0], ov)
  let rung = 0
  let check = fitCheck(input, params)
  for (let i = 1; i < rungs.length; i++) {
    if (allOverridden || check.verdict !== 'too-big') break
    const p = applyOverrides(rungs[i], ov)
    const c = fitCheck(input, p)
    params = p
    rung = i
    check = c
  }

  // 每处妥协一句人话(手动指定的字段是用户自己的主意,不归账到梯子头上)
  if (input.mmprojBytes != null && !params.mmprojOffload && ov.mmprojOffload === undefined) {
    reasons.push('视觉文件放入内存运行，看图变慢，聊天不受影响')
  }
  if (params.kvCache === 'q8_0' && ov.kvCache === undefined) {
    reasons.push('缓存改用 q8_0 并开启 Flash Attention，省约一半显存，长文本响应稍慢')
  }
  if (params.contextSize < input.requestedContext && ov.contextSize === undefined) {
    reasons.push(
      `上下文从 ${input.requestedContext} 调到 ${params.contextSize}，显存不足，先保证可运行`
    )
  }
  if (isMoe && check.verdict === 'tight') {
    reasons.push('MoE 模型，放不下的专家层使用内存运行，速度偏慢')
  }
  const overriddenNames = (
    [
      ['gpuLayers', '显卡层数'],
      ['contextSize', '上下文'],
      ['kvCache', '黑板格式'],
      ['flashAttn', 'flash-attn'],
      ['mmprojOffload', '视觉文件位置']
    ] as const
  )
    .filter(([k]) => ov[k] !== undefined)
    .map(([, label]) => label)
  if (overriddenNames.length > 0) {
    reasons.push(`${overriddenNames.join('、')}为手动指定，自动调整不会覆盖`)
  }
  reasons.push(verdictLine('gpu', check.verdict, check.needBytes, check.budgetBytes))

  return {
    params,
    args: buildArgs(params, mmprojUsed),
    rung,
    reasons,
    estimate: {
      vramBytes: Math.min(check.needBytes, check.budgetBytes),
      ramBytes: Math.max(0, check.needBytes - check.budgetBytes),
      verdict: check.verdict
    },
    mmprojUsed
  }
}

function applyOverrides(base: LaunchParams, ov: LaunchOverrides): LaunchParams {
  return {
    gpuLayers: ov.gpuLayers ?? base.gpuLayers,
    contextSize: ov.contextSize ?? base.contextSize,
    kvCache: ov.kvCache ?? base.kvCache,
    flashAttn: ov.flashAttn ?? base.flashAttn,
    mmprojOffload: ov.mmprojOffload ?? base.mmprojOffload
  }
}

/** 收尾那句账:按口径(显存/内存)说清要花多少、预算多少、结论 */
function verdictLine(
  scope: 'gpu' | 'ram',
  verdict: 'ok' | 'tight' | 'too-big',
  needBytes: number,
  budgetBytes: number
): string {
  if (scope === 'ram') {
    if (verdict === 'ok') return '内存足够，可以运行'
    if (verdict === 'tight') return '内存偏紧，可以运行，建议关闭其他应用'
    return '内存不足，无法运行，请选择更小的模型'
  }
  if (verdict === 'ok')
    return `显存需求 ${formatGB(needBytes)}，预算 ${formatGB(budgetBytes)}，可以运行`
  if (verdict === 'tight')
    return `显存需求 ${formatGB(needBytes)}，超出预算 ${formatGB(budgetBytes)}，超出部分使用内存`
  return `显存需求 ${formatGB(needBytes)}，预算 ${formatGB(budgetBytes)}，装不下；请调小上下文或更换更小的模型`
}

/** 就绪播报要用的那句「妥协说明」:上下文降了 > 投影仪在内存 > 缓存降格,都没有就 null */
export function planCaveat(plan: LaunchPlan, requestedContext: number): string | null {
  if (plan.params.contextSize < requestedContext)
    return `上下文调整为 ${plan.params.contextSize}，显存不足`
  if (plan.mmprojUsed && !plan.params.mmprojOffload) return '视觉文件在内存运行，看图会变慢'
  if (plan.params.kvCache === 'q8_0') return '缓存已换省显存的格式'
  return null
}

/** 重启对账的钥匙:永远记「用户要的档」 ——
 *  计划把上下文砍小时账上仍按用户档记,不然下一轮对不上账,引擎被反复重启 */
export function bookkeepingContextSize(requestedContext: number): number {
  return normalizeContextSize(requestedContext)
}
