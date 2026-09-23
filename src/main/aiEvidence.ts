import { userDataDir } from './paths.ts'
import {
  announceActivityBusy,
  announceActivityIdle,
  lastActivityProvider,
  setActivityProvider
} from './modelStatus.ts'
import { net, type IpcMainInvokeEvent } from 'electron'
import { promises as fs } from 'node:fs'
import {
  explainWithModel,
  explainWithMessages,
  budgetsForContext,
  probeContextSize,
  buildRefineMessages,
  hasWebLookupSignal,
  WEB_SIGNAL_INSTRUCTION,
  resolveContextSize
} from '../ai/index.ts'
import {
  webLookup,
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
  withPersonalization,
  type TeachingLevel
} from '../shared/personalization.ts'
import { buildExplainSystem, TEACHING_DEEP_MIN_CTX, TEACHING_DEGRADED_NOTE } from '../ai/prompts.ts'
import { CH } from '../shared/ipcChannels.ts'
import type {
  AiChatLookupPayload,
  AiDeltaPayload,
  AiExplainResult,
  AiStreamStats,
  ChatTarget
} from '../shared/types.ts'

/**
 * 用户点名的问题(来自 AI 面板的预设问题/输入框):追加到证据后面,
 * 让模型围绕问题作答,而不是每次都做全面介绍。不传则保持原行为。
 */
function withQuestion(prompt: string, question: unknown): string {
  if (typeof question !== 'string') return prompt
  const q = question.trim()
  if (!q) return prompt
  return `${prompt}\n\n<user_question>\n${q}\n</user_question>\n请直接围绕 <user_question> 里的问题回答(结合上面给出的文件信息),不要泛泛做全面介绍。`
}

/** 还在生成中的讲解请求,按 requestId 登记:渲染进程换了讲解目标,旧的就地掐掉,不让过气的生成占着模型排队 */
export const explainAborters = new Map<string, AbortController>()

/** 干活报告的签名缓存:同一份改动集(账本+最近提交主题一样)不重复烧模型,最多留 20 份 */
export const reportCache = new Map<string, AiExplainResult>()

/**
 * 讲解通道的共用出口:证据优先,单问单答。question 是用户点名的问题(预设/输入框),
 * 追加到证据后面让模型围绕问题作答;lookupName(只传名字,绝不传路径)给着且开关开着时,
 * 首次讲解走联网增强:先正常讲,答案带「需要联网确认」信号才查公开资料并修正。
 * (自由聊天不在这里 —— 它有自己的 atlas:ai-chat 通道和人设,不往这条路上堆条件。)
 */
/**
 * 「详细」档的锅线判定(提示词体系重写第二批):teaching 选了 deep 但模型上下文
 * 低于 TEACHING_DEEP_MIN_CTX 时,实际按 brief 装配 —— 锅装不下源码节选,硬按详细档
 * 讲只会挤出半截答案。degraded = true 时,讲解结果正文顶上垫一行程序备注(逐字稿 M)。
 * 聊天/diff/报告不吃这套 —— 只有讲解主路(respondWithEvidence 这一路)降档。
 */
export function effectiveTeaching(resolved: { teaching: TeachingLevel; ctx: number }): {
  teaching: TeachingLevel
  degraded: boolean
} {
  const degraded = resolved.teaching === 'deep' && resolved.ctx < TEACHING_DEEP_MIN_CTX
  return { teaching: degraded ? 'brief' : resolved.teaching, degraded }
}

export async function respondWithEvidence(
  event: IpcMainInvokeEvent,
  requestId: unknown,
  question: unknown,
  evidence: string,
  system: string | undefined,
  resolved: {
    target: ChatTarget
    webLookup: boolean
    budgets: { replyTokens: number }
    style: string
    ctx: number
    teaching: TeachingLevel
    tavilyKey?: string
  },
  lookupName?: string
): Promise<AiExplainResult> {
  const onDelta = makeDeltaSender(event, requestId)
  const hasQuestion = typeof question === 'string' && question.trim() !== ''
  const { teaching, degraded } = effectiveTeaching(resolved)
  // 人设口径保持原样:给了就用给的(调用方已按同一个 effectiveTeaching 装配),
  // 没给就是文件讲解官那一套;个性化一律叠在最上面
  const persona = withPersonalization(
    system ?? buildExplainSystem(teaching, 'file'),
    resolved.style
  )
  // 降档灰字:只在真讲出来了( supported )的结果顶上垫 —— 报错/取消的文本不是讲解,垫上就成了假话
  const withDegradedNote = (res: AiExplainResult): AiExplainResult =>
    degraded && res.status === 'supported'
      ? { ...res, text: `${TEACHING_DEGRADED_NOTE}\n\n${res.text}` }
      : res
  if (resolved.webLookup && lookupName && !hasQuestion) {
    // 联网那条老规矩没变:没人设时它本来就用导游那一套(和普通流不同,别一起改)
    return withDegradedNote(
      await explainWithWebLookup(
        event,
        requestId,
        evidence,
        withPersonalization(system ?? buildExplainSystem(teaching, 'folder'), resolved.style),
        lookupName,
        resolved.target,
        onDelta,
        resolved.budgets.replyTokens,
        resolved.tavilyKey
      )
    )
  }
  return withDegradedNote(
    await explainWithCancel(requestId, (signal) =>
      explainWithModel(
        resolved.target,
        withQuestion(evidence, hasQuestion ? question : undefined),
        persona,
        onDelta,
        signal,
        resolved.budgets.replyTokens,
        {
          onRestart: () => sendResetDelta(event, requestId)
        }
      )
    )
  )
}

/**
 * 联网增强的讲解:先安静地讲一遍(答案里可能带信号词),带信号就查公开资料、
 * 流式输出修正版;没信号/查不到/修正失败,都老老实实回落到本地推测的版本。
 */
async function explainWithWebLookup(
  event: IpcMainInvokeEvent,
  requestId: unknown,
  evidence: string,
  system: string,
  lookupName: string,
  target: ChatTarget,
  onDelta: ((text: string) => void) | undefined,
  replyTokens: number,
  tavilyKey?: string
): Promise<AiExplainResult> {
  const first = await explainWithCancel(requestId, (signal) =>
    explainWithModel(
      target,
      evidence + WEB_SIGNAL_INSTRUCTION,
      system,
      undefined,
      signal,
      replyTokens
    )
  )
  if (first.status !== 'supported' || !hasWebLookupSignal(first.text)) return first
  const material = await webLookup(lookupName, {
    fetchText: electronFetchText,
    postJson: electronPostJson,
    tavilyKey
  }).catch(() => '')
  if (!material) {
    // 查不到(没网/超时/太冷门):剥掉信号词,加上一句人话交代,回退本地推测
    const fallback = first.text.replace(/「?需要联网确认」?/g, '').trimEnd()
    return { ...first, text: `${fallback}\n\n(联网没查到这个,上面是本地推测。)` }
  }
  const refined = await explainWithCancel(requestId, (signal) =>
    explainWithMessages(
      target,
      buildRefineMessages(system, evidence, first.text, material),
      onDelta,
      signal,
      replyTokens,
      {
        onRestart: () => sendResetDelta(event, requestId)
      }
    )
  )
  return refined.status === 'supported' ? refined : first
}

/**
 * 带取消的讲解执行:requestId 对号入座。
 * 自动讲解时代用户会连点文件,旧生成必须能被掐断,模型才能马上讲下一个。
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
  announceActivityBusy(lastActivityProvider) // 嵌套讲解中途接续时,把「忙」续上
  try {
    return await run(aborter.signal)
  } finally {
    explainAborters.delete(requestId)
    // 只有最后一桩活收工才回「就绪」;嵌套讲解(web 查证两段式)中途不许闪
    if (explainAborters.size === 0) announceActivityIdle()
  }
}

/**
 * 文件夹/文件打不开时说人话:被 Windows 上锁的(EPERM/EACCES,常见于系统保护区)
 * 和真不存在的,必须分成两种说法 —— 谎报"不存在"会让用户以为自己删了什么东西
 */
export function accessDeniedMessage(
  err: NodeJS.ErrnoException,
  kind: '文件夹' | '文件',
  relPath: string
): string {
  if (err?.code === 'EPERM' || err?.code === 'EACCES') {
    return `「${relPath}」被 Windows 上了锁,软件没钥匙看不了 —— 这类多半是系统自管的内部文件夹,不是你的项目内容,不看也不影响`
  }
  // Windows 核心文件(如 swapfile.sys)连 stat 都不给(EINVAL),独占占用是 EBUSY —— 不是"不存在",别谎报
  if (err?.code === 'EINVAL' || err?.code === 'EBUSY') {
    return `「${relPath}」被 Windows 独占占用(多半是系统自己管的核心文件),软件读不了 —— 不是你删了什么,不看也不影响`
  }
  return `${kind}不存在:${relPath}`
}

/** 读文件开头 64KB 当「内容片段」;含 空字节 = 二进制,返回 null */
export async function readTextPreview(absPath: string): Promise<string | null> {
  const handle = await fs.open(absPath, 'r')
  try {
    const buf = Buffer.alloc(64 * 1024)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    const chunk = buf.subarray(0, bytesRead)
    if (chunk.includes(0)) return null
    return chunk.toString('utf8')
  } finally {
    await handle.close()
  }
}

/** 读文件头 64 字节给魔数识别用;只在 readTextPreview 已经成功打开过文件后调用,不另外兜错误 */
export async function readHeader(absPath: string, bytes = 64): Promise<Buffer> {
  const handle = await fs.open(absPath, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
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

/** 字节数 → 人话大小(提示词里给模型的证据) */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * 三个讲解通道共用的前置:把当前 AI 配置收敛成 ChatTarget,顺手把模型上下文摸清
 * (手动档优先,没填就向模型服务探测,再不行退回保守默认)—— 各路预算按它按比例算。
 * 选了内置模型就顺手把 llama-server 子进程拉起来(首次用 AI 才启动,不拖慢打开速度);
 * 没配好不抛异常,返回人话错误让界面原样展示。
 * webLookup = 用户开没开「联网查证」(默认关):开着且讲解认不出品牌时才联网。
 */
export async function resolveChatTargetOrError(): Promise<
  | {
      target: ChatTarget
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
      // 是否手动填的也带过去 —— 引擎启动就死时,验尸话能点名「上下文填太大」
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
  // 过了这关就是真要使唤模型了:状态栏进「忙」(第八十四锤)
  setActivityProvider(config.provider)
  announceActivityBusy(config.provider)
  // 上下文认主:手动填的数只在内置引擎当真参数;LM Studio 的锅归它自己管,
  // 一律只信探测(存档里给内置填的旧数隐身不管事),探测不到按默认窗口兜底
  const ctx = resolveContextSize(
    config.provider,
    config.contextSize,
    await probeContextSize(resolved.target, config.provider)
  )
  // 个性化段在这儿一次拼好,跟着 resolved 走遍所有调用点:全默认时是空串,人设一字不加
  const style = buildPersonalizationPrompt(sanitizePersonalization(config.personalization))
  // 讲解深度(教学三档)也在这落定:讲解底座挂哪段教学切片、deep 要不要降档,各调用点照它装配
  const teaching = sanitizePersonalization(config.personalization).teaching
  return {
    target: resolved.target,
    webLookup: config.webLookup === true,
    budgets: budgetsForContext(ctx),
    style,
    ctx,
    teaching,
    tavilyKey: config.tavilyKey
  }
}

/**
 * 流式回滚令(第一百四十三锤):复读机重答前发给界面,把这条请求已吐的字收回。
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
    // 引擎肯报账,状态栏的「忙」就跟着报数(第八十四锤)
    if (stats) announceActivityBusy(lastActivityProvider, stats)
  }
}

/** 自由对话的联网状态播报:查着没查着都是程序说了算,按 requestId 对号推给界面挂标签 */
export function sendChatLookup(
  event: IpcMainInvokeEvent,
  requestId: unknown,
  state: AiChatLookupPayload['state'],
  sources: string[]
): void {
  if (typeof requestId !== 'string' || requestId === '') return
  if (!event.sender.isDestroyed()) {
    event.sender.send(CH.aiChatLookup, {
      id: requestId,
      state,
      sources
    } satisfies AiChatLookupPayload)
  }
}
