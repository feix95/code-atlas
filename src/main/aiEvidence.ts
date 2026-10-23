import { userDataDir } from './paths.ts'
import {
  announceActivityBusy,
  announceActivityIdle,
  lastActivityProvider,
  setActivityProvider
} from './modelStatus.ts'
import { net, type IpcMainInvokeEvent } from 'electron'
import { budgetsForContext, probeContextSize, resolveContextSize } from '../ai/index.ts'
import {
  HttpStatusError,
  WEB_LOOKUP_TIMEOUT_MS,
  type LookupTransport,
  type LookupPostTransport,
  type LookupGetTransport
} from '../ai/weblookup.ts'
import { loadAiConfig, resolveAiTarget, type BuiltinRuntime } from '../ai/config.ts'
import { ensureBuiltinServer } from '../ai/builtin.ts'
import {
  buildPersonalizationPrompt,
  sanitizePersonalization,
  type TeachingLevel
} from '../shared/personalization.ts'
import { CH } from '../shared/ipcChannels.ts'
import type {
  AiChatLookupPayload,
  AiDeltaPayload,
  AiExplainResult,
  AiProviderKind,
  AiStreamStats,
  ChatTarget
} from '../shared/types.ts'

/** 还在生成中的请求,按 requestId 登记:渲染进程换了目标,旧的就地掐掉,不让过气的生成占着模型排队 */
export const explainAborters = new Map<string, AbortController>()

/**
 * 带取消的执行:requestId 对号入座。
 * 用户会连点、连问,旧生成必须能被掐断,模型才能马上干下一个。
 */
export async function explainWithCancel(
  requestId: unknown,
  run: (signal: AbortSignal) => Promise<AiExplainResult>
): Promise<AiExplainResult> {
  if (typeof requestId !== 'string' || requestId === '') {
    return run(new AbortController().signal)
  }
  const aborter = new AbortController()
  explainAborters.set(requestId, aborter)
  announceActivityBusy(lastActivityProvider) // 先把「忙」立起来,免得模型还没出声状态栏就闪回就绪
  try {
    return await run(aborter.signal)
  } finally {
    explainAborters.delete(requestId)
    // 只有最后一桩活收工才回「就绪」:并发几路请求时,先收工的不许让状态栏闪一下
    if (explainAborters.size === 0) announceActivityIdle()
  }
}

/**
 * 联网查证的传输层:走 Chromium 的网络栈(net.fetch),跟用户浏览器一个路数 ——
 * 自动跟随系统代理设置,直连到不了的站点也能按用户自己的网络环境正常查。
 * 渲染进程依旧不碰网络,查询只发生在主进程。
 */
export const electronFetchText: LookupTransport = async (url) => {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeAtlas/0.1' },
    signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** POST 版传输(Tavily 搜索用):同一个 Chromium 网络栈,JSON body + 认证头,超时口径与 GET 一致。
 *  非 2xx 抛 HttpStatusError(带状态码)—— Key 体检要按码分档说人话,普通搜索链照旧当「这个源认输」 */
export const electronPostJson: LookupPostTransport = async (url, body, headers) => {
  const res = await net.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeAtlas/0.1'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS)
  })
  if (!res.ok) throw new HttpStatusError(res.status)
  return res.text()
}

/** GET 版传输(Tavily 用量查询用):同一个 Chromium 网络栈,只带认证头,非 2xx 抛 HttpStatusError */
export const electronGetJson: LookupGetTransport = async (url, headers) => {
  const res = await net.fetch(url, {
    headers: {
      ...headers,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeAtlas/0.1'
    },
    signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS)
  })
  if (!res.ok) throw new HttpStatusError(res.status)
  return res.text()
}

/**
 * 模型请求共用的前置(自由对话与「试一句」都走这里):把当前 AI 配置收敛成 ChatTarget,
 * 顺手把模型上下文摸清(手动档优先,没填就向模型服务探测,再不行退回保守默认)—— 各路预算按它按比例算。
 * 选了内置模型就顺手把 llama-server 子进程拉起来(首次用 AI 才启动,不拖慢打开速度);
 * 没配好不抛异常,返回人话错误让界面原样展示。
 * webLookup = 用户开没开「联网查证」(默认关):开着且自由对话这轮点了联网才去查。
 */
export async function resolveChatTargetOrError(): Promise<
  | {
      target: ChatTarget
      provider: AiProviderKind
      webLookup: boolean
      budgets: { mapTokens: number; replyTokens: number }
      style: string
      ctx: number
      teaching: TeachingLevel
      tavilyKey?: string
    }
  | { error: string }
> {
  const config = await loadAiConfig(userDataDir())
  let runtime: BuiltinRuntime | undefined
  if (config.provider === 'builtin') {
    try {
      // 手动上下文直接喂给引擎(-c):预算和引擎本尊吃一个数,不再各说各话;
      // 是否手动填的也带过去 —— 引擎启动就死时,退出诊断文案能点名「上下文填太大」
      runtime = await ensureBuiltinServer(
        config.builtin,
        config.contextSize,
        config.contextSize ?? null
      )
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
  const resolved = resolveAiTarget(config, runtime)
  if (!resolved.ok) return { error: resolved.message }
  // 过了这关就是真要使唤模型了:状态栏进「忙」(第八十四批)
  setActivityProvider(config.provider)
  announceActivityBusy(config.provider)
  // 上下文认主:手动填的数只在内置引擎当真参数;LM Studio 的上下文窗口归它自己管,
  // 一律只信探测(存档里给内置填的旧数隐身不管事),探测不到按默认窗口兜底
  const ctx = resolveContextSize(
    config.provider,
    config.provider === 'cloud' ? config.cloud.contextSize : config.contextSize,
    await probeContextSize(resolved.target, config.provider)
  )
  // 个性化段在这儿一次拼好,跟着 resolved 走遍所有调用点:全默认时是空串,人设一字不加
  const style = buildPersonalizationPrompt(sanitizePersonalization(config.personalization))
  // 讲解深度(教学三档)也在这落定:讲解底座挂哪段教学切片、deep 要不要降档,各调用点照它装配
  const teaching = sanitizePersonalization(config.personalization).teaching
  return {
    target: resolved.target,
    provider: config.provider,
    webLookup: config.webLookup === true,
    budgets: budgetsForContext(ctx),
    style,
    ctx,
    teaching,
    tavilyKey: config.tavilyKey
  }
}

/**
 * 流式回滚令(第一百四十三批):复读机重答前发给界面,把这条请求已吐的字收回。
 * 按 requestId 对号入座;没带 id(非流式调用方)本来就无字可收,发不发都一样。
 */
export function sendResetDelta(event: IpcMainInvokeEvent, requestId: unknown): void {
  if (typeof requestId !== 'string' || requestId === '') return
  if (event.sender.isDestroyed()) return
  event.sender.send(CH.aiDelta, { id: requestId, text: '', reset: true } satisfies AiDeltaPayload)
}

/**
 * 流式增量推送:渲染进程带 requestId 过来,就按 id 对号入座往回推
 * 'atlas:ai-delta',边生成边显示;没带 id(老调用方)就走一次性返回。
 */
export function makeDeltaSender(
  event: IpcMainInvokeEvent,
  requestId: unknown
): ((text: string, stats?: AiStreamStats, reasoning?: string) => void) | undefined {
  if (typeof requestId !== 'string' || requestId === '') return undefined
  return (text, stats, reasoning) => {
    if (event.sender.isDestroyed()) return
    const payload: AiDeltaPayload = reasoning
      ? { id: requestId, text, reasoning }
      : { id: requestId, text }
    if (stats) payload.stats = stats
    event.sender.send(CH.aiDelta, payload)
    // 引擎回报用量,状态栏的「忙」就跟着报数(第八十四批)
    if (stats) announceActivityBusy(lastActivityProvider, stats)
  }
}

/** 自由对话的联网状态播报:查着没查着都是程序说了算,按 requestId 对号推给界面挂标签 */
export function sendChatLookup(
  event: IpcMainInvokeEvent,
  requestId: unknown,
  state: AiChatLookupPayload['state'],
  sources: string[],
  queries: string[] = []
): void {
  if (typeof requestId !== 'string' || requestId === '') return
  if (!event.sender.isDestroyed()) {
    event.sender.send(CH.aiChatLookup, {
      id: requestId,
      state,
      sources,
      queries
    } satisfies AiChatLookupPayload)
  }
}
