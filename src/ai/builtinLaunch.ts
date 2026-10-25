// 内置引擎「拉起来直到就绪」这一棒
// 从 builtin.ts 拆出来的启动域:spawn llama-server、接管 stdout/stderr、
// 轮询 /health 到就绪、问 /v1/models 拿模型名、就绪后探一轮视觉能力(/props)。
// 还有启动域的纯函数:加载进度解析、GPU 层数报告、热身估价小状态表。
// 生命周期/收尸/单飞闸门仍归 builtin.ts;引擎单例状态经 BuiltinLaunchHost 注入,
// 本文件不 import builtin.ts,避免互相绕圈。

import { spawn, type ChildProcess } from 'node:child_process'
import type { ModelStatus, VisionSupport } from '../shared/types.ts'
import { normalizeContextSize, PROBE_HEALTH_MS, PROBE_MODELS_MS } from '../shared/aiDefaults.ts'
import { addDevLog } from '../shared/devlog.ts'
import { bookkeepingContextSize, planCaveat } from '../shared/launchPlan.ts'
import {
  launchSignature,
  parseExtraArgs,
  type ModelLaunchSettings
} from '../shared/launchSettings.ts'
import { buildLaunchPlan } from './launchPlanner.ts'
import { fetchWithTimeout } from './http.ts'
import { findMmprojFor } from './mmproj.ts'
import { probeBuiltinVision } from './visionProbe.ts'
import {
  engineLogHasOom,
  estimateLoadProgress,
  gpuOffloadWarning,
  parseGpuOffloadReport,
  parseLoadProgress,
  warmupNudgeMessage,
  type GpuOffloadReport
} from './loadParsers.ts'

/** 内置 llama-server 的固定端口(与 LM Studio 默认 1234 错开) */
export const BUILTIN_PORT = 8766
const POLL_INTERVAL_MS = 1000

/** 用户按了取消/卸下时,挂起的启动等待收到的一句话(不是故障,是「先不用了」) */
export const CANCEL_MESSAGE = '加载取消了:想用的时候再问一句,它会重新热身'

/** 进程型失败专用错误:带退出码,退出诊断/保险丝判定时好认(普通 Error = 没起成/spawn 层失败) */
export class EngineExitError extends Error {
  exitCode: number | null
  constructor(exitCode: number | null, message: string) {
    super(message)
    this.name = 'EngineExitError'
    this.exitCode = exitCode
  }
}

/** 引擎就绪回报:目标地址、模型名,以及实际喂给 -c 的上下文档位(启动梯子可能降过档) */
export interface BuiltinReady {
  baseUrl: string
  model: string
  contextSize: number
}

/**
 * 启动时要借道的 builtin.ts 单例状态与播报口。
 * 引擎子进程/启动参数账/叫停标记都记在 builtin.ts 那边,这里只经口子读写。
 */
export interface BuiltinLaunchHost {
  /** spawn 出来的子进程回登到模块单例 */
  setChild(child: ChildProcess | null): void
  /** 引擎还在跑吗(health 轮询的退出条件) */
  isEngineRunning(): boolean
  /** 用户/系统正在主动叫停(exit 监听据此闭嘴) */
  isStopping(): boolean
  /** 新一轮启动清掉上次的叫停账 */
  resetStopping(): void
  /** 记下这次实际喂给引擎的 -c 档位、--mmproj 路径与高级启动账签名(对账状态表) */
  markStarted(ctxSize: number, mmprojPath: string, launchSig: string): void
  /** 状态栏播报(loading/ready/error) */
  announce(status: ModelStatus): void
  /** 组一份内置 provider 的状态卡(与 builtin.ts 同一工厂) */
  status(
    state: ModelStatus['state'],
    modelName: string,
    sizeBytes: number | null,
    progress?: number | null,
    message?: string,
    estimated?: boolean,
    vision?: VisionSupport
  ): ModelStatus
  /** 模型文件的展示信息(名字/块头/失踪提醒) */
  idleFacts(modelPath: string): {
    modelName: string
    sizeBytes: number | null
    message?: string
  }
  /** 引擎 PID 落档/销档(强杀孤儿收尸用) */
  writeEnginePidFile(pid: number): void
  clearEnginePidFileFor(pid: number | undefined): void
  /** 热身状态表读写(builtin.ts 管 userData 目录;估价基准/入账) */
  readWarmupMs(modelPath: string): number | null
  recordWarmupMs(modelPath: string, ms: number): void
  /** 引擎日志里见了显存不够的记号(保险丝据此换「显存不够」那句人话) */
  noteEngineOom(seen: boolean): void
}

// 启动期的纯算盘(热身估价/进度解析/GPU 层数/显存记号)住在 loadParsers.ts;
// 这里转手老登记,builtin.ts 与自测照旧从 builtinLaunch 进
export {
  warmupNudgeMessage,
  estimateLoadProgress,
  parseLoadProgress,
  parseGpuOffloadReport,
  gpuOffloadWarning,
  engineLogHasOom
} from './loadParsers.ts'
export type { GpuOffloadReport } from './loadParsers.ts'

/** 就绪后问服务加载了哪个模型(llama-server 以模型文件名作为模型 id) */
async function fetchModelId(baseUrl: string): Promise<string> {
  const modelsRes = await fetchWithTimeout(`${baseUrl}/models`, PROBE_MODELS_MS)
  if (!modelsRes.ok) {
    throw new Error(`内置模型已就绪,但拿不到模型信息(${modelsRes.status}),再点一次试试`)
  }
  const data = (await modelsRes.json()) as { data?: Array<{ id?: string }> }
  const model = data.data?.[0]?.id ?? ''
  if (!model) throw new Error('内置模型已就绪,但报告不出模型名,再点一次试试')
  return model
}

/**
 * 拉起 llama-server 并等它就绪:出启动方案 → spawn → /health 轮询(503 带进度就报真数,
 * 没报按热身状态表估一条)→ /v1/models 拿模型名 → /props 探视觉能力 → 报 ready。
 * skipMmproj = 保险丝重拉:上次带投影仪把自己拉死了,这次摘掉按纯文本跑,
 * 就绪播报捎一句人话说明。
 */
export async function launchBuiltinServer(
  host: BuiltinLaunchHost,
  serverPath: string,
  modelPath: string,
  baseUrl: string,
  contextSize: number,
  launch: ModelLaunchSettings | null = null,
  opts: {
    skipMmproj?: boolean
    mmprojDropNote?: string
    /** devlog 启动行展示的引擎名('CUDA 加速 · b11685'/'自带引擎'/'自指引擎') */
    engineLabel?: string
    /** 后端退路重拉成功时就绪播报捎的一句 */
    engineNote?: string
  } = {}
): Promise<BuiltinReady> {
  const skipMmproj = opts.skipMmproj ?? false
  const mmprojDropNote = opts.mmprojDropNote
  const engineLabel = opts.engineLabel
  const engineNote = opts.engineNote
  const ctxSize = normalizeContextSize(contextSize)
  // 模型同目录躺着 mmproj 投影仪就带上 --mmproj,视觉模型才真能看图;
  // 没带就按纯文本跑。记进对账状态表 —— 旁边增删 mmproj 后下次提问对账重启
  const mmproj = skipMmproj ? null : findMmprojFor(modelPath)
  // 机器规格 + 模型登记过一遍纯算盘,出本轮启动参数;用户在「高级」里
  // 指定过的字段原样进算盘,梯子不碰。显卡层数默认交给引擎 --fit 自动摆层。
  const { plan } = await buildLaunchPlan(modelPath, ctxSize, mmproj, launch?.overrides)
  // 专家命令行:白名单解析,合法的排在方案参数之后(后写赢);非法整段丢弃只留日志,不拦启动
  const extra = parseExtraArgs(launch?.extraArgs ?? '')
  const extraArgs = extra.ok ? extra.args : []
  if (launch?.extraArgs && !extra.ok) {
    addDevLog('system', `专家参数被拒:${extra.reason} —— 按自动方案启动`)
  }
  // 对账状态表永远记「用户要的档」:计划把上下文调小时账上仍按用户档记,
  // 不然下一轮对不上账,引擎被反复重启(自测钉死这条约定)
  host.markStarted(bookkeepingContextSize(contextSize), mmproj ?? '', launchSignature(launch))
  host.resetStopping() // 新的一轮启动:上次「主动叫停」的标记就地清账
  host.noteEngineOom(false) // OOM 记号账也清掉,只认本轮引擎日志
  const facts = host.idleFacts(modelPath)
  const startedAt = Date.now()
  const lastWarmupMs = host.readWarmupMs(modelPath)
  // 引擎要干什么,先在后台日志里亮个底 —— 参数全摆出来,LM Studio 同款透明度
  addDevLog(
    'system',
    `启动内置引擎:${engineLabel ? `${engineLabel}(${serverPath})` : serverPath} · 模型 ${modelPath} · 端口 ${BUILTIN_PORT} · 工具模板(--jinja)${mmproj ? ` · 视觉投影仪(--mmproj ${mmproj})` : ''} · 方案参数:${plan.args.join(' ') || '(引擎默认)'}${extraArgs.length ? ` · 专家参数:${extraArgs.join(' ')}` : ''}`
  )
  // 方案为什么这么配,每条理由都留底(用户界面上挑最要紧的一句,全量走这里)
  for (const reason of plan.reasons) addDevLog('system', `启动方案:${reason}`)
  const child = spawn(
    serverPath,
    [
      '-m',
      modelPath,
      '--port',
      String(BUILTIN_PORT),
      '--host',
      '127.0.0.1',
      // --jinja:让引擎用模型自带的对话模板,工具调用(agent 的
      // 翻文件)靠它才开得了;chat_template_kwargs 的思考开关也走这条路。换模型后生效
      '--jinja',
      ...(mmproj ? ['--mmproj', mmproj] : []),
      // 方案参数(-c/-ngl/--no-mmproj-offload/-ctk/-ctv/-fa)由纯算盘给出;
      // auto 层数时这里绝不出 -ngl,引擎的 --fit 才有权自动摆层。
      // 专家参数排在最后:同名旗后写赢(用户显式指定优先于算盘)
      ...plan.args,
      ...extraArgs
    ],
    {
      windowsHide: true,
      // stdout/stderr 接管(原来直接扔)—— 引擎的原话进 Developer 日志窗口
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  host.setChild(child)
  // 引擎活着档就在(收尸盲区修复):spawn 成功落 PID,app 被强杀留下的孤儿下次照档收尸;
  // 闭包记死这个 pid —— 模块级 child 会被 stopBuiltinServer 置空或被新引擎换岗
  const spawnedPid = child.pid
  if (spawnedPid !== undefined) host.writeEnginePidFile(spawnedPid)
  let latestGpuOffload: GpuOffloadReport | null = null
  const captureEngineLine = (line: string): void => {
    if (!line.trim()) return
    addDevLog('engine', line)
    latestGpuOffload = parseGpuOffloadReport(line) ?? latestGpuOffload
    if (engineLogHasOom(line)) host.noteEngineOom(true)
  }
  // 引擎吐的每一行原话都进状态表:llama.cpp 把日志几乎全写在 stderr(模型结构、显存分配、
  // 加载耗时……),stdout 偶尔也有;两个管道都接,进度条的回车刷新按行拆开
  const feedEngineStream = (stream: NodeJS.ReadableStream | null): void => {
    if (!stream) return
    let leftover = ''
    stream.on('data', (chunk: Buffer) => {
      leftover += chunk.toString('utf8')
      const lines = leftover.split(/\r\n|\r|\n/)
      leftover = lines.pop() ?? ''
      for (const line of lines) captureEngineLine(line)
    })
    stream.on('end', () => captureEngineLine(leftover))
  }
  feedEngineStream(child.stdout)
  feedEngineStream(child.stderr)
  const announceLoading = (realProgress: number | null): void => {
    const elapsed = Date.now() - startedAt
    const est = realProgress ?? estimateLoadProgress(elapsed, lastWarmupMs)
    host.announce(
      host.status(
        'loading',
        facts.modelName,
        facts.sizeBytes,
        est,
        warmupNudgeMessage(elapsed),
        est !== null && realProgress === null
      )
    )
  }
  announceLoading(null)

  // 子进程半路夭折(路径不对、缺 DLL、端口被占)→ 挂起的等待直接收到人话错误;
  // 是用户自己按的取消/卸下就说「取消了」,别吓人。带退出码的专用错误,退出诊断时好认
  const exitError = new Promise<never>((_, reject) => {
    child.once('exit', (code) => {
      host.clearEnginePidFileFor(spawnedPid)
      addDevLog(
        'system',
        host.isStopping()
          ? `引擎已停止(主动叫停,退出码 ${code ?? '未知'})`
          : `引擎启动就退出了(退出码 ${code ?? '未知'})`
      )
      reject(
        new EngineExitError(
          code ?? null,
          host.isStopping()
            ? CANCEL_MESSAGE
            : `内置模型程序启动失败就退出了(退出码 ${code ?? '未知'}):常见原因是程序路径没指对、模型文件损坏,或端口被占用`
        )
      )
    })
    child.once('error', (err) => {
      addDevLog('system', `引擎没法启动:${err.message}`)
      const msg =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? '找不到 llama-server 程序:去「AI 设置」重新选一下程序路径'
          : `内置模型程序没法启动:${err.message}`
      reject(new Error(msg))
    })
  })

  const healthUrl = baseUrl.replace(/\/v1$/, '') + '/health'
  const ready = (async () => {
    // 不设闹钟:进程活着就一直等 —— 机械盘搬 14GB 模型两三分钟是常事,
    // 2 分钟的硬超时只会掐死健康的加载;真死锁交给用户手里的「取消」
    while (host.isEngineRunning()) {
      try {
        const res = await fetchWithTimeout(healthUrl, PROBE_HEALTH_MS)
        if (res.ok) break // 200 = 模型加载完毕
        if (res.status === 503) {
          // 还在加载:服务报了进度就用真数,没报就按上次耗时估一条,每秒往前走
          const body = await res.text().catch(() => '')
          let parsed: unknown
          try {
            parsed = JSON.parse(body)
          } catch {
            parsed = null
          }
          announceLoading(parseLoadProgress(parsed))
        }
      } catch {
        // 还没开始监听端口,继续等;估价也照走,别让百分比卡在原地
        announceLoading(null)
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    if (!host.isEngineRunning())
      throw new EngineExitError(null, '内置模型进程提前退出了,检查路径和模型文件')

    // 热身真耗时入账:下次同一模型的估价就有据可依
    host.recordWarmupMs(modelPath, Date.now() - startedAt)
    addDevLog(
      'system',
      `引擎就绪:模型加载完成,耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`
    )

    // 就绪后问它加载了哪个模型;刚就绪就断线的话给人话兜底
    let model: string
    try {
      model = await fetchModelId(baseUrl)
    } catch (err) {
      throw err instanceof Error && err.message.includes('内置模型')
        ? err
        : new Error('内置模型刚就绪就没了响应,再点一次试试')
    }
    const offloadWarning = gpuOffloadWarning(latestGpuOffload)
    if (offloadWarning) addDevLog('system', offloadWarning)
    // 就绪后问一轮 /props:modalities.vision 是引擎自己报的能力账,状态栏标签认它
    const vision = await probeBuiltinVision(baseUrl)
    // 降级重拉成功的要跟人讲清楚:眼睛没装上,现在按纯文本跑着;
    // 方案里的妥协(上下文调小/投影仪放内存/黑板降格)也挑最要紧的一句一并说明
    const readyNote = [
      offloadWarning,
      skipMmproj ? (mmprojDropNote ?? '视觉文件没能加载,已按纯文本启动') : null,
      engineNote ?? null,
      planCaveat(plan, ctxSize)
    ]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .join(';')
    host.announce(
      host.status('ready', model, facts.sizeBytes, 100, readyNote || undefined, false, vision)
    )

    // 就绪之后再夭折(跑着跑着崩了):状态栏如实报故障,下次提问会自动重新拉起;
    // 用户主动卸下的不算,走 stopping 标记闭嘴
    child.once('exit', (code) => {
      host.clearEnginePidFileFor(spawnedPid)
      addDevLog(
        'system',
        host.isStopping()
          ? `引擎已停止(主动叫停,退出码 ${code ?? '未知'})`
          : `引擎中途退出了(退出码 ${code ?? '未知'})`
      )
      if (!host.isStopping()) {
        host.announce(
          host.status(
            'error',
            model,
            facts.sizeBytes,
            null,
            `内置模型中途退出了(退出码 ${code ?? '未知'}),下次提问会自动重新启动`
          )
        )
      }
    })
    return { baseUrl, model, contextSize: plan.params.contextSize }
  })()

  // 谁先出结果听谁的:就绪 or 进程夭折
  return Promise.race([ready, exitError])
}
