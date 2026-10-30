// 内置模型 Provider:把 llama-server 当独立子进程养起来。
// 它一启动就暴露 OpenAI 兼容的 HTTP API,对上层来说和 LM Studio 没区别 ——
// 都是"一个 baseURL + 一个模型名",业务代码不感知底下是谁在跑。
// 生命周期:首次用到 AI 才启动(不拖慢 app 打包体积和启动速度);app 退出时杀掉。
// 端口固定 8766,避开 LM Studio 默认的 1234。上次异常退出留下的孤儿进程,启动/用时收尸还端口。
//
// 本文件只留「启动编排」这一层:收尸账住 engineProcess,热身账住 warmupStore,
// 状态播报住 builtinStatus,适配估算住 modelFit,机器规格住 machineSpec;
// 下面统一转一手,老朋友(适配估算/自测/main 进程)照旧从 builtin 进。
import type { ChildProcess } from 'node:child_process'
import type { AiBuiltinSettings } from '../shared/types.ts'
import { DEFAULT_CONTEXT_SIZE, normalizeContextSize } from '../shared/aiDefaults.ts'
import { addDevLog } from '../shared/devlog.ts'
import { launchFor, launchSignature, type ModelLaunchSettings } from '../shared/launchSettings.ts'
import { ENGINE_CATALOG } from '../shared/engineCatalog.ts'
import { locateEngine } from './engineLocator.ts'
import { findMmprojFor, shouldRetryWithoutMmproj } from './mmproj.ts'
import {
  BUILTIN_PORT,
  CANCEL_MESSAGE,
  EngineExitError,
  launchBuiltinServer,
  type BuiltinLaunchHost,
  type BuiltinReady
} from './builtinLaunch.ts'
import {
  announceBuiltin,
  announceBuiltinError,
  builtinIdleFacts,
  builtinStatus
} from './builtinStatus.ts'
import {
  clearEnginePidFileFor,
  reapEngineOrphans,
  writeEnginePidFile,
  type OrphanReapResult
} from './engineProcess.ts'
import { readWarmupMs, recordWarmupMs } from './warmupStore.ts'
import { builtinDataDir } from './builtinDataDir.ts'
import { autopsyExitMessage, judgeModelFit } from './modelFit.ts'
import { queryMachineSpec } from './machineSpec.ts'
import { createSingleFlight } from './singleFlight.ts'
import { settingsKey } from './builtinKey.ts'

// 老登记转手(实现在各专属模块,这里保住 import 路径)
export { estimateKvBytes } from '../shared/contextBill.ts'
export {
  warmupNudgeMessage,
  estimateLoadProgress,
  parseLoadProgress,
  parseGpuOffloadReport,
  gpuOffloadWarning,
  EngineExitError
} from './builtinLaunch.ts'
export type { GpuOffloadReport } from './builtinLaunch.ts'
export {
  setBuiltinStatusAnnouncer,
  lastBuiltinStatus,
  builtinIdleFacts,
  builtinVisionSupport,
  builtinIdleStatus,
  announceBuiltinIdle
} from './builtinStatus.ts'
export { setBuiltinWarmupDir } from './builtinDataDir.ts'
export { parseWarmupSamples, averageWarmup, nextWarmupStore } from './warmupStore.ts'
export { parseNvidiaSmi, queryMachineSpec } from './machineSpec.ts'
export type { MachineSpec } from './machineSpec.ts'
export { judgeModelFit, autopsyExitMessage, readModelShape } from './modelFit.ts'
export type { ModelFitVerdictPure } from './modelFit.ts'
export {
  parseListenerPids,
  parseTasklistImage,
  parseEnginePidFile,
  inspectBuiltinConflict
} from './engineProcess.ts'

/**
 * 引擎自动定位的登记搬去了 enginePath.ts;单飞闸门搬去了 singleFlight.ts
 */
export { resolveServerProgram } from './enginePath.ts'
export { createSingleFlight } from './singleFlight.ts'

/** 当前子进程与它的就绪结果(模块级单例:整个 app 只养一个内置模型) */
let child: ChildProcess | null = null
let readyPromise: Promise<BuiltinReady> | null = null
/** 当前子进程是用哪组设置拉起的(serverPath|modelPath),换模型时判断要不要重启 */
let startedKey = ''
/** 当前子进程是按哪档「用户要的上下文」拉起的(重启对账用;实际 -c 可能被启动梯子调低) */
let startedCtx = 0
/** 当前子进程实际喂给 --mmproj 的路径(空串 = 没带眼睛);模型旁增删 mmproj 后要按新参数重启 */
let startedMmproj = ''
/** 这一轮启动的引擎日志里见过显存不够的记号(保险丝据此换「显存不够」那句人话) */
let engineOomSeen = false
/** 当前引擎是按哪份「高级启动账」拉起的(改账重启对账用) */
let startedLaunchSig = ''
/** 主动叫停标记:取消/卸下触发的进程退出不当故障报,下次启动时复位 */
let stopping = false

export function isBuiltinRunning(): boolean {
  return child !== null && child.exitCode === null
}

/** 对账键住在 builtinKey.ts;转手老登记(自测与 main 进程照旧从 builtin 进) */
export { settingsKey } from './builtinKey.ts'

/** 设置有变(换了模型文件或引擎路径)而旧进程还在跑:得重启才作数。
 *  模型旁的 mmproj 增删也算 —— 引擎还按旧参数跑着,下次提问该按新参数重拉 */
export function builtinNeedsRestart(settings: AiBuiltinSettings): boolean {
  if (!isBuiltinRunning()) return false
  return (
    startedKey !== settingsKey(settings) ||
    startedMmproj !== (findMmprojFor(settings.modelPath) ?? '')
  )
}

/** 模型旁的 mmproj 跟正在跑的引擎对不上账:下次提问要重启引擎带上新参数 */
export function builtinMmprojDiffers(modelPath: string): boolean {
  if (!isBuiltinRunning()) return false
  return startedMmproj !== (findMmprojFor(modelPath) ?? '')
}

/** 上下文档位有变而旧引擎还按旧档跑着:得重启才作数(2026-09-13 白屏案顺带的账)。
 * 以前改档位被「引擎已在跑就复用」一口吞掉 —— 滑块拖了、保存了、界面还显示新数,
 * 引擎压根没听见,静默不生效;现在对不上账就明说,由调用方决定何时重启。 */
export function builtinContextDiffers(contextSize: number): boolean {
  if (!isBuiltinRunning()) return false
  return startedCtx !== normalizeContextSize(contextSize)
}

/** 这个模型的高级启动账跟正在跑的引擎对不上:改了 override/专家参数,下次提问要重启 */
export function builtinLaunchDiffers(settings: AiBuiltinSettings): boolean {
  if (!isBuiltinRunning()) return false
  return startedLaunchSig !== launchSignature(launchFor(settings))
}

/** 收尸入口:引擎正跑着就不用管,剩下的交给 engineProcess */
export async function reapOrphanServer(): Promise<OrphanReapResult> {
  if (isBuiltinRunning()) return { killed: false }
  return reapEngineOrphans()
}

const startBuiltinSingleFlight = createSingleFlight(
  async (
    settings: AiBuiltinSettings,
    contextSize: number,
    manualContext: number | null
  ): Promise<BuiltinReady> => {
    const modelPath = settings.modelPath.trim()
    if (!modelPath) {
      const err = new Error('还没设置 AI。打开设置,选择一个本地模型;不设置也能浏览项目地图。')
      announceBuiltinError(modelPath, err)
      throw err
    }
    let serverPath: string
    let engineLabel: string
    let engineFallback: { exePath: string; label: string } | null = null
    let engineBackendKind: 'custom' | 'installed' | 'vendor' | 'none'
    let engineBackendId: string | null
    try {
      // 引擎定位:自指路径 > 已装引擎(按选择/推荐)> 自带 vendor;
      // installed 引擎自带「下一颗退路」给启动保险丝
      const engine = await locateEngine(settings, builtinDataDir())
      if (!engine.exePath) {
        throw new Error('未找到内置 AI 引擎，在 AI 设置中安装引擎或改用 LM Studio')
      }
      serverPath = engine.exePath
      engineLabel = engine.label
      engineBackendKind = engine.kind
      engineBackendId = engine.backend
      if (engine.fallbackExe && engine.fallbackLabel) {
        engineFallback = { exePath: engine.fallbackExe, label: engine.fallbackLabel }
      }
    } catch (err) {
      announceBuiltinError(settings.modelPath, err)
      throw err
    }

    // 先收尸:上次异常退出留下的孤儿还堵着端口的话,先请走再拉新的
    const reap = await reapOrphanServer()
    if (reap.blockedBy) {
      const err = new Error('本地模型端口被其他程序占用，请先停止该程序')
      announceBuiltinError(modelPath, err)
      throw err
    }

    const baseUrl = `http://127.0.0.1:${BUILTIN_PORT}/v1`
    const launch = launchFor(settings)
    // 对账键按「设置」记(不记解析后的 exe 路径):同一设置在 needsRestart 那边才算得平
    startedKey = settingsKey(settings)
    // 重拉预算:投影仪保险丝 + 后端退路两条线,合起来最多重拉 2 次,不许循环兜底
    let relaunches = 0
    readyPromise = startAndWaitReady(serverPath, modelPath, baseUrl, contextSize, launch, {
      engineLabel
    })
    try {
      return await readyPromise
    } catch (err) {
      // 保险丝:带了 --mmproj、引擎却「自己退了」型失败 → 投影仪跟模型
      // 对不上账,摘掉它按纯文本重拉一次;只兜这一次,第二次仍失败照常退出诊断上报,
      // 别把模型损坏/显存不够这类真错吞掉。用户主动叫停的不降级。
      const engineExited = err instanceof EngineExitError
      let finalErr = err
      if (
        relaunches < 2 &&
        !stopping &&
        shouldRetryWithoutMmproj(startedMmproj || null, engineExited)
      ) {
        relaunches++
        // 上一轮引擎日志里见过显存不够的记号,话术就直说显存;不然按普通「没装上」说
        const dropNote = engineOomSeen
          ? '显存不足，视觉文件未加载，已按纯文本启动'
          : '视觉文件未加载，已按纯文本启动'
        addDevLog(
          'system',
          `视觉投影仪加载失败(${startedMmproj}),摘掉 --mmproj 按纯文本重拉一次${engineOomSeen ? '(引擎报过显存不够)' : ''}`
        )
        readyPromise = startAndWaitReady(serverPath, modelPath, baseUrl, contextSize, launch, {
          skipMmproj: true,
          mmprojDropNote: dropNote,
          engineLabel
        })
        try {
          return await readyPromise
        } catch (retryErr) {
          finalErr = retryErr // 降级重拉也挂了:落回下面的退出诊断/上报,人话照实说
        }
      }
      // 保险丝:installed 引擎一启动就退(驱动/运行库对不上),顺着优先级链
      // 退到下一颗引擎重拉一次;用户叫停的不退,vendor/自指引擎没有退路也不退。
      // 这是链条上最后一条保险丝,触发即占满 relaunches<2 的剩余预算,不必再自增
      if (
        relaunches < 2 &&
        !stopping &&
        engineBackendKind === 'installed' &&
        engineFallback !== null &&
        finalErr instanceof EngineExitError
      ) {
        const fromName = engineBackendId
          ? ENGINE_CATALOG[engineBackendId as keyof typeof ENGINE_CATALOG].displayName
          : '所选'
        const switchNote = `${fromName}引擎没能启动,已改用 ${engineFallback.label}`
        addDevLog('system', `${switchNote}(退出码 ${finalErr.exitCode ?? '未知'})`)
        readyPromise = startAndWaitReady(
          engineFallback.exePath,
          modelPath,
          baseUrl,
          contextSize,
          launch,
          { engineLabel: engineFallback.label, engineNote: switchNote }
        )
        try {
          return await readyPromise
        } catch (fallbackErr) {
          finalErr = fallbackErr // 退路也走死:落回退出诊断/上报
        }
      }
      // 启动失败:清干净现场,下次再试能重新拉起;用户主动叫停的算「还没叫醒」,真出错的才报故障
      const facts = builtinIdleFacts(modelPath)
      if (stopping) {
        announceBuiltin(
          builtinStatus('idle', facts.modelName, facts.sizeBytes, null, CANCEL_MESSAGE)
        )
      } else {
        // 退出诊断:启动就死的,拿适配估算分清「内存耗尽退出/上下文填爆/文件坏」,不再一句「可能太大」糊弄人
        if (finalErr instanceof EngineExitError) {
          const spec = await queryMachineSpec()
          finalErr.message = autopsyExitMessage(
            finalErr.exitCode,
            judgeModelFit(
              facts.sizeBytes ?? 0,
              spec.ramBytes,
              spec.vramBytes,
              normalizeContextSize(contextSize)
            ),
            manualContext
          )
        }
        announceBuiltinError(modelPath, finalErr)
      }
      stopBuiltinServer()
      throw finalErr
    }
  }
)

/**
 * 确保 llama-server 跑起来了,返回它的 ChatTarget(baseUrl + 模型名)。
 * 已在跑就直接复用;没跑就走单飞闸门拉起(同秒并发的第二个请求等同一份,
 * 绝不双生):收尸清端口、拉起、轮询 /health 直到就绪、再问 /v1/models 拿模型名。
 * contextSize 是喂给引擎的上下文窗口(-c):设置里手动填了就用填的,没填按默认(shared/aiDefaults)。
 * 引擎优先用 app 自带的,用户只管选模型文件。
 * 所有失败都抛"给人看的人话",由 IPC 层原样转给界面;状态栏同步收到播报。
 */
export async function ensureBuiltinServer(
  settings: AiBuiltinSettings,
  contextSize = DEFAULT_CONTEXT_SIZE,
  manualContext: number | null = null
): Promise<BuiltinReady> {
  if (isBuiltinRunning() && readyPromise) {
    // 参数对不上账就解散重拉:上下文档位对不上(2026-09-13 白屏案),或模型旁的
    // mmproj 增删了(引擎还按旧参数跑,新眼睛白放)—— 单飞开头会收尸并等端口放行
    const ctxDiffers = builtinContextDiffers(contextSize)
    const mmprojDiffers = builtinMmprojDiffers(settings.modelPath)
    // 对账键一把罩:程序路径/模型/引擎后端/高级启动账,任何一项变了都得重启
    const settingsDiffers = startedKey !== settingsKey(settings)
    if (!ctxDiffers && !mmprojDiffers && !settingsDiffers) return readyPromise
    addDevLog(
      'system',
      ctxDiffers
        ? `上下文档位改成了 ${normalizeContextSize(contextSize)},重启引擎让它生效`
        : mmprojDiffers
          ? '模型旁的 mmproj 文件变了,重启引擎带上新参数'
          : '启动设置或引擎选择改了,重启引擎让它生效'
    )
    stopBuiltinServer()
  }
  return startBuiltinSingleFlight(settings, contextSize, manualContext)
}

/**
 * 启动要借道的单例状态与播报口,收成一个口子递给 builtinLaunch.ts
 * (那边不 import 本文件,引擎单例仍归这里记账,不互相绕圈)。
 */
const launchHost: BuiltinLaunchHost = {
  setChild: (c) => (child = c),
  isEngineRunning: isBuiltinRunning,
  isStopping: () => stopping,
  resetStopping: () => (stopping = false),
  markStarted: (ctxSize, mmprojPath, launchSig) => {
    startedCtx = ctxSize
    startedMmproj = mmprojPath
    startedLaunchSig = launchSig
  },
  noteEngineOom: (seen) => (engineOomSeen = seen),
  announce: announceBuiltin,
  status: builtinStatus,
  idleFacts: builtinIdleFacts,
  writeEnginePidFile,
  clearEnginePidFileFor,
  readWarmupMs,
  recordWarmupMs
}

/**
 * 拉起引擎并等它就绪(具体活在 builtinLaunch.ts):
 * 记设置账 → spawn → /health 轮询 → /v1/models → /props 视觉探测 → 报 ready。
 * skipMmproj 是保险丝重拉(上次带投影仪把自己拉死了,摘掉按纯文本再来一次)。
 */
function startAndWaitReady(
  serverPath: string,
  modelPath: string,
  baseUrl: string,
  contextSize = DEFAULT_CONTEXT_SIZE,
  launch: ModelLaunchSettings | null = null,
  opts: {
    skipMmproj?: boolean
    mmprojDropNote?: string
    /** devlog 启动行展示的引擎名('CUDA 加速 · b11685'/'自带引擎'/'自指引擎') */
    engineLabel?: string
    /** 后端退路重拉成功时就绪播报捎的一句('CUDA 引擎没能启动,已改用 X') */
    engineNote?: string
  } = {}
): Promise<BuiltinReady> {
  return launchBuiltinServer(launchHost, serverPath, modelPath, baseUrl, contextSize, launch, opts)
}

/** 杀掉内置模型子进程。幂等:没在跑就直接返回。取消/卸下/app 退出都走这里。 */
export function stopBuiltinServer(): void {
  if (child && child.exitCode === null) {
    stopping = true // 主动叫停:exit 监听别把「先不用了」报成故障
    child.kill()
  }
  child = null
  readyPromise = null
  startedKey = ''
  startedCtx = 0
  startedMmproj = ''
  startedLaunchSig = ''
}
