import { app, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, screen, shell, Tray, BrowserWindow, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { basename, join } from 'node:path'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { scanDirectory, IGNORED_NAMES } from '../scanner/index.ts'
import {
  AGENT_FILE_MAX_BYTES,
  AGENT_LIST_MAX_ENTRIES,
  AGENT_MAX_DEPTH,
  AGENT_MAX_ROUNDS,
  AGENT_REMINDER_MIN_TOOL_CALLS,
  AGENT_REMINDER_PREFIX,
  AGENT_SEARCH_MAX_FILES,
  AGENT_SEARCH_MAX_MATCHES,
  AGENT_SEARCH_MAX_PATH_HITS,
  AGENT_WEB_ADDENDUM,
  ROUND_CAP_NUDGE,
  REPEAT_NUDGE,
  SALVAGE_CITE_NUDGE,
  SALVAGE_NUDGE_MAX,
  SALVAGE_SEARCH_NUDGE,
  agentPromptBudget,
  agentReadChars,
  agentRound,
  agentStepText,
  buildAgentReminder,
  compressAgentMessages,
  extractToolCalls,
  emergencySlim,
  findAnswerGap,
  isFindQuestion,
  mergeUsage,
  sanitizeAgentRelPath,
  stripLastAgentReminder,
  toolCallKey,
  wrapToolResult,
  type AgentChatMessage,
  type AgentStreamEvent
} from '../ai/agent.ts'
import { THINKING_EXTRA_TOKENS } from '../shared/aiDefaults.ts'
import { asToolName, TOOL_NAMES } from '../shared/agentTools.ts'
import { buildCompactMessages, sanitizeCompactHistory, sanitizeCompactSummary } from '../shared/compact.ts'
import { stripCurrentQuestionAnchor } from '../shared/chatHistory.ts'
import { createMascotWindow, getMascotWindow, hideMascot, isMascotHidden, registerMascotIpc, seatMascotAt, setMascotHiddenListener, showMascot, toggleMascot } from './mascot.ts'
import { mainPanelMenuLabel, mascotMenuLabel } from './mascotState.ts'
import { MainPanelController } from './mainPanel.ts'
import { followBubble, hideBubble, openBubble, registerBubbleIpc, toggleBubble } from './bubble.ts'
import { DETACH_MARGIN_PX, isOutsideBounds } from './freechatHost.ts'
import { annotateSummaries } from '../summarizer/index.ts'
import { analyzeSource, isAnalysisSupported } from '../analyzer/index.ts'
import { buildDependencyGraph } from '../depgraph/index.ts'
import { collectGitChanges, collectRecentSubjects, getChangeDiff, gitChangesSignature } from '../git/index.ts'
import {
  codeRefsBudget,
  estimateTokens,
  explainWithModel,
  explainWithMessages,
  buildExplainPrompt,
  extractHeaderComment,
  buildDiffPrompt,
  buildFolderPrompt,
  buildGuessPrompt,
  buildBinaryPrompt,
  buildReportPrompt,
  buildLocatePrompt,
  buildTreeDigest,
  parseLocateReply,
  filterLocateHits,
  budgetsForContext,
  isContextOverflow,
  probeContextSize,
  DEFAULT_CONTEXT_SIZE,
  REPORT_ROW_LIMIT,
  sniffBinaryKind,
  sanitizeHistory,
  buildAttachmentText,
  sanitizeAttachment,
  sanitizeCodeRefs,
  buildFreeChatMessages,
  pickWebLookupQuery,
  resolveWebLookupMeta,
  buildRefineMessages,
  hasWebLookupSignal,
  hasSearchIntent,
  WEB_SIGNAL_INSTRUCTION,
  parseLmStudioModelState,
  DIFF_SYSTEM_PROMPT,
  REPORT_SYSTEM_PROMPT,
  LOCATE_SYSTEM_PROMPT,
  LOCATE_NODE_BUDGET,
  STYLE_SAMPLE_SYSTEM,
  STYLE_SAMPLE_QUESTION,
  resolveContextSize
} from '../ai/index.ts'
import { truncateAtRepetition } from '../ai/repetition.ts'
import { webLookupDetailed, webLookup, webSearchDetailed, probeTavilyKey, HttpStatusError, sanitizeWebQuery, WEB_LOOKUP_TIMEOUT_MS, type LookupTransport, type LookupPostTransport, type LookupGetTransport } from '../ai/weblookup.ts'
import { loadAiConfig, saveAiConfig, resolveAiTarget, type BuiltinRuntime } from '../ai/config.ts'
import { fetchModelShelf, fetchRepoFiles } from '../ai/modelShelf.ts'
import { cancelModelDownload, pointConfigAtModel, startModelDownload } from '../ai/modelDownload.ts'
import { builtinContextDiffers, builtinNeedsRestart, builtinIdleStatus, ensureBuiltinServer, isBuiltinRunning, judgeModelFit, lastBuiltinStatus, queryMachineSpec, readModelShape, reapOrphanServer, setBuiltinStatusAnnouncer, setBuiltinWarmupDir, stopBuiltinServer } from '../ai/builtin.ts'
import { BY_EXT } from '../shared/languages.ts'
import { isBinaryFile } from '../shared/fileKinds.ts'
import { joinRoot } from '../shared/paths.ts'
import { clipPreview, looksBinary, PREVIEW_MAX_BYTES } from '../shared/preview.ts'
import { highlightSource } from '../highlight/index.ts'
import { buildPersonalizationPrompt, sanitizePersonalization, withPersonalization, type TeachingLevel } from '../shared/personalization.ts'
import { AGENT_FILES_ADDENDUM, buildChatSystem, buildExplainSystem, deepSourceChars, SLICE_NO_TOOLS, TEACHING_DEEP_MIN_CTX, TEACHING_DEGRADED_NOTE } from '../ai/prompts.ts'
import { formatStreamStats } from '../shared/aiText.ts'
import { addDevLog, clearDevLogs, devLogSnapshot, setDevLogListener } from '../shared/devlog.ts'
import { placeWindowBox, readWindowState, WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH, writeWindowState, type WindowBox } from './window-state.ts'
import { armRevealWatchdog, loadView, VIEWS, WEB_PREFS } from './atlasWindow.ts'
import { SOURCE_PARSE_MAX_BYTES } from '../shared/analysisLimits.ts'
import { CONTEXT_SIZE_MIN, DEFAULT_LMSTUDIO_BASE_URL, PROBE_LMSTUDIO_MS, PROBE_MODELS_MS } from '../shared/aiDefaults.ts'
import { CH } from '../shared/ipcChannels.ts'
import { fetchWithTimeout, stripApiSuffix } from '../ai/http.ts'
import { queryDriveKinds } from './drive-meta.ts'
import { AgentDirectoryAccess, joinAuthorizedRoot, sanitizeExternalDirectoryPath } from './agentAccess.ts'
import { loadAppearanceFileSync, saveAppearanceFile } from './appearanceStore.ts'
import { sanitizeAppearance } from '../shared/appearancePrefs.ts'
import { sanitizeTavilyKey } from '../shared/tavily.ts'
import type { AgentSearchCard, AgentSearchMatch, AiChatLookupPayload, AiChatResult, AiConfig, AiDeltaPayload, AiExplainResult, AiProviderKind, AiStreamStats, AiUsage, ChatTarget, DriveInfo, FeatureLocateResult, FilePreviewResult, FreechatHost, ModelContextInfo, ModelFitVerdict, ModelStatus, ScanDirNode, WebLookupMeta } from '../shared/types.ts'

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

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
const explainAborters = new Map<string, AbortController>()
const agentDirectoryAccess = new AgentDirectoryAccess()

/** 干活报告的签名缓存:同一份改动集(账本+最近提交主题一样)不重复烧模型,最多留 20 份 */
const reportCache = new Map<string, AiExplainResult>()

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
function effectiveTeaching(resolved: { teaching: TeachingLevel; ctx: number }): { teaching: TeachingLevel; degraded: boolean } {
  const degraded = resolved.teaching === 'deep' && resolved.ctx < TEACHING_DEEP_MIN_CTX
  return { teaching: degraded ? 'brief' : resolved.teaching, degraded }
}

async function respondWithEvidence(
  event: IpcMainInvokeEvent,
  requestId: unknown,
  question: unknown,
  evidence: string,
  system: string | undefined,
  resolved: { target: ChatTarget; webLookup: boolean; budgets: { replyTokens: number }; style: string; ctx: number; teaching: TeachingLevel; tavilyKey?: string },
  lookupName?: string
): Promise<AiExplainResult> {
  const onDelta = makeDeltaSender(event, requestId)
  const hasQuestion = typeof question === 'string' && question.trim() !== ''
  const { teaching, degraded } = effectiveTeaching(resolved)
  // 人设口径保持原样:给了就用给的(调用方已按同一个 effectiveTeaching 装配),
  // 没给就是文件讲解官那一套;个性化一律叠在最上面
  const persona = withPersonalization(system ?? buildExplainSystem(teaching, 'file'), resolved.style)
  // 降档灰字:只在真讲出来了( supported )的结果顶上垫 —— 报错/取消的文本不是讲解,垫上就成了假话
  const withDegradedNote = (res: AiExplainResult): AiExplainResult =>
    degraded && res.status === 'supported' ? { ...res, text: `${TEACHING_DEGRADED_NOTE}\n\n${res.text}` } : res
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
      explainWithModel(resolved.target, withQuestion(evidence, hasQuestion ? question : undefined), persona, onDelta, signal, resolved.budgets.replyTokens, {
        onRestart: () => sendResetDelta(event, requestId)
      })
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
    explainWithModel(target, evidence + WEB_SIGNAL_INSTRUCTION, system, undefined, signal, replyTokens)
  )
  if (first.status !== 'supported' || !hasWebLookupSignal(first.text)) return first
  const material = await webLookup(lookupName, { fetchText: electronFetchText, postJson: electronPostJson, tavilyKey }).catch(() => '')
  if (!material) {
    // 查不到(没网/超时/太冷门):剥掉信号词,加上一句人话交代,回退本地推测
    const fallback = first.text.replace(/「?需要联网确认」?/g, '').trimEnd()
    return { ...first, text: `${fallback}\n\n(联网没查到这个,上面是本地推测。)` }
  }
  const refined = await explainWithCancel(requestId, (signal) =>
    explainWithMessages(target, buildRefineMessages(system, evidence, first.text, material), onDelta, signal, replyTokens, {
      onRestart: () => sendResetDelta(event, requestId)
    })
  )
  return refined.status === 'supported' ? refined : first
}

/**
 * 带取消的讲解执行:requestId 对号入座。
 * 自动讲解时代用户会连点文件,旧生成必须能被掐断,模型才能马上讲下一个。
 */
async function explainWithCancel(
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
function accessDeniedMessage(err: NodeJS.ErrnoException, kind: '文件夹' | '文件', relPath: string): string {
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
async function readTextPreview(absPath: string): Promise<string | null> {
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
async function readHeader(absPath: string, bytes = 64): Promise<Buffer> {
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
const electronFetchText: LookupTransport = async (url) => {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeAtlas/0.1' },
    signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** POST 版传输(Tavily 搜索用):同一个 Chromium 网络栈,JSON body + 认证头,超时口径与 GET 一致。
 *  非 2xx 抛 HttpStatusError(带状态码)—— Key 体检要按码分档说人话,普通搜索链照旧当「这个源认输」 */
const electronPostJson: LookupPostTransport = async (url, body, headers) => {
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeAtlas/0.1' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS)
  })
  if (!res.ok) throw new HttpStatusError(res.status)
  return res.text()
}

/** GET 版传输(Tavily 用量查询用):同一个 Chromium 网络栈,只带认证头,非 2xx 抛 HttpStatusError */
const electronGetJson: LookupGetTransport = async (url, headers) => {
  const res = await net.fetch(url, {
    headers: { ...headers, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodeAtlas/0.1' },
    signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS)
  })
  if (!res.ok) throw new HttpStatusError(res.status)
  return res.text()
}

/** 字节数 → 人话大小(提示词里给模型的证据) */
function formatSize(bytes: number): string {
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
async function resolveChatTargetOrError(): Promise<
  { target: ChatTarget; webLookup: boolean; budgets: { mapTokens: number; replyTokens: number }; style: string; ctx: number; teaching: TeachingLevel; tavilyKey?: string } | { error: string }
> {
  const config = await loadAiConfig(app.getPath('userData'))
  let runtime: BuiltinRuntime | undefined
  if (config.provider === 'builtin') {
    try {
      // 手动上下文直接喂给引擎(-c):预算和引擎本尊吃一个数,不再各说各话;
      // 是否手动填的也带过去 —— 引擎启动就死时,验尸话能点名「上下文填太大」
      runtime = await ensureBuiltinServer(config.builtin, config.contextSize, config.contextSize ?? null)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
  const resolved = resolveAiTarget(config, runtime)
  if (!resolved.ok) return { error: resolved.message }
  // 过了这关就是真要使唤模型了:状态栏进「忙」(第八十四锤)
  lastActivityProvider = config.provider
  announceActivityBusy(config.provider)
  // 上下文认主:手动填的数只在内置引擎当真参数;LM Studio 的锅归它自己管,
  // 一律只信探测(存档里给内置填的旧数隐身不管事),探测不到按默认窗口兜底
  const ctx = resolveContextSize(config.provider, config.contextSize, await probeContextSize(resolved.target, config.provider))
  // 个性化段在这儿一次拼好,跟着 resolved 走遍所有调用点:全默认时是空串,人设一字不加
  const style = buildPersonalizationPrompt(sanitizePersonalization(config.personalization))
  // 讲解深度(教学三档)也在这落定:讲解底座挂哪段教学切片、deep 要不要降档,各调用点照它装配
  const teaching = sanitizePersonalization(config.personalization).teaching
  return { target: resolved.target, webLookup: config.webLookup === true, budgets: budgetsForContext(ctx), style, ctx, teaching, tavilyKey: config.tavilyKey }
}

/**
 * 流式回滚令(第一百四十三锤):复读机重答前发给界面,把这条请求已吐的字收回。
 * 按 requestId 对号入座;没带 id(非流式调用方)本来就无字可收,发不发都一样。
 */
function sendResetDelta(event: IpcMainInvokeEvent, requestId: unknown): void {
  if (typeof requestId !== 'string' || requestId === '') return
  if (event.sender.isDestroyed()) return
  event.sender.send(CH.aiDelta, { id: requestId, text: '', reset: true } satisfies AiDeltaPayload)
}

/**
 * 流式增量推送:渲染进程带 requestId 过来,就按 id 对号入座往回推
 * 'atlas:ai-delta',边生成边显示;没带 id(老调用方)就走一次性返回。
 */
function makeDeltaSender(event: IpcMainInvokeEvent, requestId: unknown): ((text: string, stats?: AiStreamStats, reasoning?: string) => void) | undefined {
  if (typeof requestId !== 'string' || requestId === '') return undefined
  return (text, stats, reasoning) => {
    if (event.sender.isDestroyed()) return
    const payload: AiDeltaPayload = reasoning ? { id: requestId, text, reasoning } : { id: requestId, text }
    if (stats) payload.stats = stats
    event.sender.send(CH.aiDelta, payload)
    // 引擎肯报账,状态栏的「忙」就跟着报数(第八十四锤)
    if (stats) announceActivityBusy(lastActivityProvider, stats)
  }
}

/** 自由对话的联网状态播报:查着没查着都是程序说了算,按 requestId 对号推给界面挂标签 */
function sendChatLookup(event: IpcMainInvokeEvent, requestId: unknown, state: AiChatLookupPayload['state'], sources: string[]): void {
  if (typeof requestId !== 'string' || requestId === '') return
  if (!event.sender.isDestroyed()) {
    event.sender.send(CH.aiChatLookup, { id: requestId, state, sources } satisfies AiChatLookupPayload)
  }
}

// ── 第七十锤:模型状态栏的后厨 ──
// 内置引擎的状态由 builtin.ts 播报员推过来;外接 LM Studio 没法订阅,只能低频去问。
// 两路都汇到 broadcastModelStatus,渲染层的常驻底栏只认这一条频道。

function broadcastModelStatus(status: ModelStatus): void {
  // 第八十八锤:必须挨个窗都发 —— Developer 日志窗进了队,「[0]」不一定是主窗;
  // 广播喂给没人听的日志窗,主窗底栏就冻死在「还没叫醒」
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CH.modelStatus, status)
  }
}

/** 问一轮 LM Studio:模型加载了没/热身到多少;服务没开就老实说没连上,不装没事 */
async function probeLmStudioStatus(config: AiConfig): Promise<ModelStatus> {
  const model = config.lmstudio.model.trim()
  const root = stripApiSuffix(config.lmstudio.baseUrl.trim() || DEFAULT_LMSTUDIO_BASE_URL)
  const base = { provider: 'lmstudio' as const, modelName: model, sizeBytes: null, progress: null }
  if (!model) return { ...base, state: 'idle', message: '还没填模型名:去「AI 设置」连一下 LM Studio' }
  try {
    const res = await fetchWithTimeout(`${root}/api/v0/models`, PROBE_LMSTUDIO_MS)
    if (res.ok) {
      const parsed = parseLmStudioModelState(await res.json().catch(() => null), model)
      return { ...base, state: parsed.state, progress: parsed.progress }
    }
    // 老版本 LM Studio 没有 v0 接口:OpenAI 兼容口能列出模型就当就绪
    const legacy = await fetchWithTimeout(`${root}/v1/models`, PROBE_LMSTUDIO_MS)
    return { ...base, state: legacy.ok ? 'ready' : 'unreachable' }
  } catch {
    return { ...base, state: 'unreachable', message: 'LM Studio 没连上:那边开了「开发者」本地服务,这边才看得到' }
  }
}

/** 手动刷一次状态:外接走探测广播;内置的状态归引擎播报员管,这里不越权 */
async function refreshModelStatus(): Promise<void> {
  const config = await loadAiConfig(app.getPath('userData'))
  if (config.provider === 'lmstudio') {
    const status = await probeLmStudioStatus(config)
    lastLmStudioStatus = status
    broadcastModelStatus(status)
  }
}

// ── 「忙」播报(第八十四锤):就绪 ≠ 闲着 —— 模型请求从发出到收工,状态栏全程在场 ──
// 起点在 resolveChatTargetOrError(每个模型请求的必经口),终点在 explainWithCancel /
// 自由对话的 finally(explainAborters 清空才收工,嵌套的讲解不会中途闪「就绪」)。
let lastLmStudioStatus: ModelStatus | null = null
let lastActivityProvider: AiProviderKind = 'builtin'

/** 当前该拿谁的身份说「忙」:内置用播报员手里的真身,外接用最近一轮探测 */
function announceActivityBusy(provider: AiProviderKind, stats?: AiStreamStats): void {
  lastActivityProvider = provider
  const base = provider === 'builtin' ? lastBuiltinStatus() : lastLmStudioStatus
  if (!base) return
  // 引擎还在热身时,加载播报员 owns 这个频道,「忙」不许抢话
  if (base.state === 'loading' || base.state === 'idle') return
  const message = stats ? formatStreamStats(stats) : '在干活……'
  broadcastModelStatus({ ...base, state: 'busy', progress: null, estimated: undefined, message })
}

/** 一轮活干完(或干砸了):回到「就绪」,别让「忙」挂在那里变成谎话 */
function announceActivityIdle(): void {
  const provider = lastActivityProvider
  const base = provider === 'builtin' ? lastBuiltinStatus() : lastLmStudioStatus
  if (!base) return
  if (base.state !== 'loading' && base.state !== 'idle') {
    broadcastModelStatus({ ...base, state: 'ready', progress: null, estimated: undefined })
  }
}

// ── Developer 日志窗口(第八十七锤):模型后台原话亮出来看 ──
// 独立小窗(frameless,和主窗一个壳),渲染层用 ?view=devlogs 分支画日志页。
// 引擎的每一行原话、每笔请求报账,广播员推给所有窗口,这窗常驻收听。

let devLogWindow: BrowserWindow | null = null

// ── 托盘常驻与单实例(桌宠托管第一锤,2026-09-18)──
// 收起模式的地基:主窗引用提升到模块级,托盘和 second-instance 都要够得着它。
let mainWindowRef: BrowserWindow | null = null
let mainPanelController: MainPanelController | null = null
let tray: Tray | null = null
// 真退出旗:托盘「退出」先立旗再 quit,close 事件看见旗才放行销毁 ——
// 不立旗的话关窗=收起,窗口永远走不到销毁那一步
let quitting = false

/** 把主窗带回前台:托盘「显示主面板」、左键点托盘、第二个实例敲门,都走这条 */
function showMainWindow(): void {
  mainPanelController?.show()
}

// ── 小探针形态机(走出面板锤,2026-09-19 小葵拍板)──
// 自由对话一份内容两种形态:panel = 住在主面板页签(原始形态);pet = 变身桌宠趴桌面。
// 互斥铁律:同一时刻只显示一份。状态唯一事实源在这儿,广播出去各窗只管画自己。
// 桌宠不再是常驻宠物:对话住进桌宠时它才上岗,收回主面板它就下班。

let freechatHost: FreechatHost = 'panel'

/** 形态变了喊一声:主窗页签 ↔ 占位卡跟着换装(目前只有主窗订阅) */
function broadcastFreechatHost(): void {
  const win = mainWindowRef
  if (win && !win.isDestroyed()) win.webContents.send(CH.freechatHost, freechatHost)
}

/** 桌宠 lazy 上岗:没窗现建,有窗直接用(回收时只藏不销,再放出秒到位) */
function ensureMascot(): BrowserWindow {
  const win = getMascotWindow()
  if (win) return win
  return createMascotWindow(app.getPath('userData'))
}

/** 放出:页签拖出主窗松手 → 桌宠在松手点落座 + 自动弹一次气泡报「接到啦」。
 * force = 页签右键菜单点的「放到桌面」:不判窗外,桌宠落记忆位(没记忆按默认角),
 * 主面板顺手藏起来 —— 菜单点这句就是「人不要面板了」,拖放那条路不动。
 * 主窗渲染层已筛过「chat 品类且没钉住」,这里只做最后一步几何判定 */
function detachFreechat(force = false): void {
  const win = mainWindowRef
  if (!win || win.isDestroyed() || freechatHost === 'pet') return
  const cursor = screen.getCursorScreenPoint()
  if (!force && !isOutsideBounds(win.getBounds(), cursor.x, cursor.y, DETACH_MARGIN_PX)) return
  freechatHost = 'pet'
  broadcastFreechatHost()
  if (force) mainPanelController?.hide()
  const pet = ensureMascot()
  if (!force) seatMascotAt(cursor.x, cursor.y)
  showMascot() // 假藏叫回:页面画回身体+穿透归轮询,不真 hide 那套(第五案)
  openBubble(pet.getBounds())
  addDevLog('system', '小探针走出面板,变身桌宠')
}

/** 收回:气泡头钮 / 占位卡 / 桌宠右键菜单三条路汇这一条 ——
 * 主窗亮 + 页签复活 + 气泡收 + 桌宠下班 */
function dockFreechat(): void {
  if (freechatHost !== 'panel') {
    freechatHost = 'panel'
    broadcastFreechatHost()
  }
  hideBubble()
  hideMascot()
  showMainWindow()
}

/** 托盘图标:开发模式读仓库里的 build/icon.ico;打包后从 resources/app.ico 认
 * (electron-builder.yml 的 extraResources 负责把它搬进去) */
function trayIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'app.ico') : join(app.getAppPath(), 'build/icon.ico')
}

/** 托盘菜单按当时真实状态下菜:主面板在屏上给「藏起它」,不在给「叫它出来」;
 * 桌宠同理(假藏后 isVisible 会说谎,问 mascotHidden 旗) */
function buildTrayMenu(): Menu {
  const mainShown = mainPanelController?.isShown() ?? false
  return Menu.buildFromTemplate([
    {
      label: mainPanelMenuLabel(mainShown),
      click: () => (mainShown ? mainPanelController?.hide() : showMainWindow())
    },
    { label: mascotMenuLabel(isMascotHidden()), click: () => toggleMascot() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
}

/** 主面板/桌宠露面状态一翻账就重摆菜单:别让人对着过期文案点菜 */
function refreshTrayMenu(): void {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu())
}

function createTray(): void {
  const icon = nativeImage.createFromPath(trayIconPath())
  if (icon.isEmpty()) addDevLog('system', '托盘图标没加载出来(文件缺失?),托盘会显示默认空白图 —— 不影响功能')
  tray = new Tray(icon)
  tray.setToolTip('CodeAtlas')
  tray.setContextMenu(buildTrayMenu())
  setMascotHiddenListener(refreshTrayMenu)
  // Windows 惯例:左键点托盘 = 唤回主面板
  tray.on('click', () => showMainWindow())
}

function openDevLogWindow(): void {
  if (devLogWindow && !devLogWindow.isDestroyed()) {
    devLogWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 780,
    height: 560,
    minWidth: 560,
    minHeight: 380,
    title: 'Developer 日志 · CodeAtlas',
    autoHideMenuBar: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    show: false,
    webPreferences: WEB_PREFS
  })
  devLogWindow = win
  win.on('closed', () => {
    if (devLogWindow === win) devLogWindow = null
  })
  // 露窗三保险和主窗同一条链(工厂上弦):ready-to-show 快路 + 渲染层双 rAF 首帧信号
  // (按 sender 认窗,不抢主窗的信号)+ 3 秒看门狗,绝不永久隐身
  armRevealWatchdog(win, { firstFrame: 'shared' })
  loadView(win, VIEWS.devlogs)
}

function createWindow(): void {
  // ── 第七十八锤:窗口尺寸记事本 ──
  // 上回把窗拉到多大、搁在哪儿,这回开窗就照旧;最大化单独记一票,还原时先落回上次的
  // 正常大小再最大化(最大化时 getBounds 是铺满屏的假尺寸,不能当正常尺寸记)。
  // 存档先过安检再落窗:垃圾存档走默认,旧存档对着现在的屏幕贴边夹紧(换屏/改分辨率
  // 也不把窗送出屏外)。记不住(读写失败)就当没这回事,走默认 —— 锦上添花不添乱。
  const savedWindowState = readWindowState(app.getPath('userData'))
  const placedBox = savedWindowState
    ? placeWindowBox(savedWindowState.box, screen.getAllDisplays().map((d) => d.workArea))
    : null
  let normalBox: WindowBox | null = savedWindowState ? savedWindowState.box : null
  let stateSaveTimer: NodeJS.Timeout | null = null

  const mainWindow = new BrowserWindow({
    width: placedBox?.width ?? 1200,
    height: placedBox?.height ?? 800,
    ...(placedBox && placedBox.x !== undefined && placedBox.y !== undefined ? { x: placedBox.x, y: placedBox.y } : {}),
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    title: 'CodeAtlas',
    // 圆角悬浮壳回归(模块四):frame:false 摘系统框,transparent 让四角露出真实桌面,
    // 14px 圆角 + 悬浮阴影全由 CSS 画。系统级圆角(DWM roundedCorners)只有 Windows 11
    // (build 22000+)认,本机 Win10 19045 不认 —— 所以抗锯齿圆角只有透明合成这一条路。
    // 上次「窗隐身」的病根已查明:不是透明本身,而是 show:false 时 ready-to-show 在
    // 4K + 150% 缩放屏上永不触发(实底窗同样隐身,第三十六锤补实测)。这次 show:false
    // 只是为了等首帧防白闪,但绝不指望 ready-to-show —— 露窗走下面的三保险链。
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false, // 系统影子跟着方框走,会描出一圈直角细线;悬浮阴影改由 CSS 画圆角的
    autoHideMenuBar: true,
    show: false,
    webPreferences: WEB_PREFS
  })
  // 主窗引用上提(桌宠托管第一锤):托盘、second-instance 都要够得着它
  mainWindowRef = mainWindow
  mainPanelController = new MainPanelController(mainWindow)
  mainPanelController.onShownChange = refreshTrayMenu

  // 记事本落盘:平常拖大拖小/挪地方都是 debounce 攒 0.5 秒写一回,关窗那一刻清表补写;
  // 最大化时不记铺满屏的假尺寸,只记「是最大化」这一票
  const persistWindowState = (): void => {
    if (mainWindow.isDestroyed()) return
    writeWindowState(app.getPath('userData'), {
      box: normalBox ?? mainWindow.getBounds(),
      maximized: mainWindow.isMaximized()
    })
  }
  const scheduleWindowStateSave = (): void => {
    if (stateSaveTimer) clearTimeout(stateSaveTimer)
    stateSaveTimer = setTimeout(persistWindowState, 500)
  }
  const noteNormalBounds = (): void => {
    if (!mainWindow.isDestroyed() && !mainWindow.isMaximized()) normalBox = mainWindow.getBounds()
  }
  mainWindow.on('resize', () => {
    noteNormalBounds()
    scheduleWindowStateSave()
  })
  mainWindow.on('move', () => {
    noteNormalBounds()
    scheduleWindowStateSave()
  })
  mainWindow.on('maximize', scheduleWindowStateSave)
  mainWindow.on('unmaximize', () => {
    noteNormalBounds()
    scheduleWindowStateSave()
  })
  mainWindow.on('close', (event) => {
    if (stateSaveTimer) clearTimeout(stateSaveTimer)
    persistWindowState()
    // 收起模式(桌宠托管第一锤):点关闭 = 藏进托盘,程序继续跑、聊天继续在线、
    // 任务栏和 Alt+Tab 里都不再有主窗。真退出只走托盘「退出」—— 它先立 quitting
    // 旗再 quit,close 事件看见旗才放行销毁
    if (!quitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })
  // 上回关窗时是最大化:先把存档的正常大小落好,再进最大化,圆角描边那条链照常接手
  if (savedWindowState?.maximized) mainWindow.maximize()

  // ── 露窗链(工厂上弦):多路信号抢跑 + 无条件看门狗,窗口绝不永久隐身 ──
  // 本机实测(模块四验收):ready-to-show 只在 GPU 缓存健康时才来 —— 缓存被另一个
  // 实例锁住(Gpu Cache Creation failed)或被污染时就永远装死;当年「窗隐身」就是
  // 两实例缓存大战 + show 眼巴巴等 ready-to-show 叠出来的。所以每一路都只当快路,
  // 谁都不许当唯一依靠,3 秒看门狗才是保底。
  // 主窗独占 first-frame 通道(exclusive):桌宠/气泡/日志窗共用同一个 preload 都发信号,
  // 不独占不过滤的话,小家伙的帧会替主窗「报平安」,提前露白窗才冤
  let shownVia = 'never'
  armRevealWatchdog(mainWindow, {
    firstFrame: 'exclusive',
    beforeShow: (_win, via) => {
      shownVia = via
      console.log(`[window] 露窗方式:${via}`)
    }
  })
  // 3) 加载完主动催一帧:万一合成器还醒着,别让它干等
  // 「接回横幅」:救生圈动过手(reload 完/GPU 重启完)就捎个信,让页面弹一句人话
  let revivePending = false
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.invalidate()
    // 顺手把模型状态问一轮:状态栏一开屏就有真话可说,不用干等轮询
    void refreshModelStatus().catch(() => {})
    if (revivePending) {
      revivePending = false
      mainWindow.webContents.send(CH.rendererRevived)
    }
  })
  // 救生圈(2026-09-13 小葵两次报案:「界面凭空消失,后台还开着」)。这窗是透明无边框的,
  // 渲染层一崩或 GPU 进程一打嗝重启,窗口就整窗透明 —— 看着像消失,其实进程全活着。
  // 渲染层真崩:记进后台账本(账本住主进程,渲染层死了也活着),reload 把页面重挂回来。
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    console.log(`[window] 渲染层断了(${details.reason}),自动重接`)
    addDevLog('system', `画面断了一次(渲染层 ${details.reason}),已自动重接 —— 页面回到刚打开的样子`)
    revivePending = true
    if (!mainWindow.isDestroyed()) mainWindow.webContents.reload()
  })
  // GPU 进程打嗝:页面本身是活的(实测 CPU/内存/连接全正常),只是透明窗再也等不来新画面。
  // 催一帧 + 藏了再亮,逼 DWM 重开一块新画布,页面状态(聊天/扫描结果)一分不丢。
  // Electron 44 起 GPU 的事件只挂在 app 级(child-process-gone),按 processType 认出 GPU 再动手
  const onGpuGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails & { type: string }): void => {
    if (details.type !== 'GPU' || details.reason === 'clean-exit') return
    console.log(`[window] GPU 进程断了(${details.reason}),重开画布`)
    addDevLog('system', `画面断了一次(GPU 进程 ${details.reason}),已自动重接 —— 你正在看的内容没丢`)
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.invalidate()
    if (mainWindow.isVisible()) {
      mainWindow.hide()
      mainWindow.show()
    }
    mainWindow.webContents.send(CH.rendererRevived)
  }
  app.on('child-process-gone', onGpuGone)
  mainWindow.on('closed', () => {
    app.removeListener('child-process-gone', onGpuGone)
  })
  // 卡死不拉黑:渲染层主线程僵住超过 10 秒记一笔,让后台账本有话可查(不动手,等它自己醒)
  mainWindow.webContents.on('unresponsive', () => {
    console.log('[window] 渲染层没响应了一阵')
    addDevLog('system', '画面卡住了一阵(渲染层没响应) —— 记一笔备查')
  })
  // 外接 LM Studio 没法订阅它的内部状态:低频去问(10 秒一轮,本地请求很轻);
  // 内置引擎靠播报员事件推,不占这个轮询
  const modelStatusTimer = setInterval(() => {
    void refreshModelStatus().catch(() => {})
  }, 10_000)
  // 5 秒心跳:强制重画一帧(第四案的自动补丁)。内容没变时这一下几乎零成本;
  // 但只要 Windows 合成器哪一下把透明窗掉了链子,最多 5 秒就有一帧新画递过去,
  // 窗口自己接上 —— 不用等小葵来报案。
  const repaintHeartbeat = setInterval(() => {
    if (mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return
    mainWindow.webContents.invalidate()
  }, 5_000)
  // ── 救生圈 2.0(第五案实测定性后立):隐身的真身是「渲染进程活着,画面管线却永久
  // 停摆」——实测这种状态下重画/藏亮/改尺寸全都叫不醒,唯一有效的解药是整页重挂
  // (重载后画面 100% 复活)。所以不再干等它自己醒:渲染层用 rAF 每秒报一跳
  // 「画面循环还在转」;窗明明露着、心跳却停了 10 秒以上,主进程直接 reload 重挂管线,
  // 自动满血,不用小葵按任何键。心跳同时是常驻取证:rAF 停没停,后台账本里看得见。
  // 只认主窗发的跳(日志窗共用同一个渲染入口,别让它替主窗保平安)。
  let lastFrameBeat = Date.now()
  const onFrameBeat = (event: Electron.IpcMainEvent): void => {
    if (!mainWindow.isDestroyed() && event.sender === mainWindow.webContents) lastFrameBeat = Date.now()
  }
  ipcMain.on(CH.frameHeartbeat, onFrameBeat)
  const frameBeatWatchdog = setInterval(() => {
    if (mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return
    const gap = Date.now() - lastFrameBeat
    if (gap <= 10_000) return
    console.log(`[window] 画面心跳停了 ${gap}ms,自动整页重挂(救生圈2.0)`)
    addDevLog('system', `画面管线停了约 ${Math.round(gap / 1000)} 秒,已自动重挂救回 —— 刚才没聊完的内容没能保住,抱歉`)
    revivePending = true
    lastFrameBeat = Date.now() // 重挂期间先续上账,免得看门狗连开两枪
    mainWindow.webContents.reload()
  }, 3_000)
  // 手动拉起(保底,两段式):第一按还是无损那套(重画 + 藏了再亮,聊天记录不丢);
  // 10 秒内连按第二下 = 无损招数全试过还没亮,直接整页重挂保命(实测唯一解药)。
  // 保命窗口 3 秒改 10 秒(2026-09-13 白屏案):小白遇到隐身第一下按完会先看一眼结果,
  // 3 秒根本来不及按第二下 —— 那晚小葵连按三下全超时,保命招一次都没触发过。
  const HOTKEY_ARM_MS = 10_000
  let hotkeyArmed = false
  let hotkeyArmTimer: NodeJS.Timeout | null = null
  globalShortcut.register('CommandOrControl+Alt+0', () => {
    if (mainWindow.isDestroyed()) return
    if (hotkeyArmed) {
      if (hotkeyArmTimer) clearTimeout(hotkeyArmTimer)
      hotkeyArmed = false
      console.log('[window] 手动拉起第二按:整页重挂保命(Ctrl+Alt+0 ×2)')
      addDevLog('system', '手动拉起第二按:整页重挂保命(Ctrl+Alt+0 ×2)')
      revivePending = true
      mainWindow.webContents.reload()
      return
    }
    hotkeyArmed = true
    if (hotkeyArmTimer) clearTimeout(hotkeyArmTimer)
    hotkeyArmTimer = setTimeout(() => {
      hotkeyArmed = false
    }, HOTKEY_ARM_MS)
    console.log('[window] 手动拉起画面(Ctrl+Alt+0;还不亮就 10 秒内再按一次整页重挂)')
    addDevLog('system', '手动拉起画面(Ctrl+Alt+0;画面还是不亮的话,10 秒内再按一次整页重挂)')
    mainWindow.webContents.invalidate()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.hide()
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) mainWindow.show()
    }, 120)
  })
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null
      mainPanelController = null
    }
    clearInterval(modelStatusTimer)
    clearInterval(repaintHeartbeat)
    clearInterval(frameBeatWatchdog)
    ipcMain.removeListener(CH.frameHeartbeat, onFrameBeat)
    if (hotkeyArmTimer) clearTimeout(hotkeyArmTimer)
    globalShortcut.unregister('CommandOrControl+Alt+0')
    // 主窗走了,Developer 日志窗没有独活的意义:一起带走,应用照常退出
    if (devLogWindow && !devLogWindow.isDestroyed()) devLogWindow.close()
  })

  // 最大化是两副面孔:贴满屏幕时圆角描边必须收掉,四角才不漏出怪缝 —— 状态一变就喊渲染进程换装
  const syncMaximized = (maximized: boolean): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CH.windowMaximized, maximized)
  }
  mainWindow.on('maximize', () => syncMaximized(true))
  mainWindow.on('unmaximize', () => syncMaximized(false))

  // 外部链接交给系统浏览器打开,不在应用里开新窗口
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式加载 Vite 开发服务器,打包后加载本地文件(工厂代跑;主窗不带 ?view=,默认页就是它)
  loadView(mainWindow)

  // 验收探针(只在设置了 ATLAS_PROBE_DIR 时启用):露窗后截整窗图 + 记账再退出,
  // 专门伺候「100%/125%/150% 三档缩放实测」当证据;正常跑应用完全不碰这段
  const probeDir = process.env['ATLAS_PROBE_DIR']
  if (probeDir) {
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500)) // 露窗后再稳两秒半,让画面完全落定
      const scale = await mainWindow.webContents.executeJavaScript('String(window.devicePixelRatio)').catch(() => 'unknown')
      const image = await mainWindow.webContents.capturePage().catch(() => null)
      const png = image ? image.toPNG() : Buffer.alloc(0)
      const report = {
        devicePixelRatio: scale,
        shownVia,
        visible: mainWindow.isVisible(),
        maximized: mainWindow.isMaximized(),
        bounds: mainWindow.getBounds(),
        pngBytes: png.length
      }
      await fs.mkdir(probeDir, { recursive: true })
      await fs.writeFile(join(probeDir, `probe-dpr${scale}.json`), JSON.stringify(report, null, 2))
      if (png.length > 0) await fs.writeFile(join(probeDir, `probe-dpr${scale}.png`), png)
      app.quit()
    })()
  }
}

// ── 翻文件模式(agent,第一百二十八锤)的后厨 ──
// 模型自己喊「看看这个文件夹 / 读这个文件」,主进程是唯一动手的那只手:
// 只有两件只读工具,路径全走 joinRoot 沙盒,越界/二进制/超大文件一律拒,
// 拒的话术当「工具结果」喂回给模型让它自己换路,循环绝不因为一次碰壁就断。

/** list_files 的执行手:递归列文件/文件夹名单(只捡名字),条数和深度都有缰绳 */
async function agentListFiles(rootPath: string, relPath: string): Promise<{ ok: boolean; text: string; hint?: string }> {
  let abs: string
  try {
    abs = await joinAuthorizedRoot(rootPath, relPath)
  } catch {
    return { ok: false, text: `路径越界了(不在项目内):${relPath}` }
  }
  const lines: string[] = []
  let truncated = false
  let locked = 0 // 打不开的子目录数(权限/被占用),如实报给模型
  const queue: Array<{ abs: string; rel: string; depth: number }> = [{ abs, rel: relPath, depth: 0 }]
  while (queue.length > 0 && !truncated) {
    const item = queue.shift() as { abs: string; rel: string; depth: number }
    let dirents
    try {
      dirents = await fs.readdir(item.abs, { withFileTypes: true })
    } catch {
      locked += 1
      continue
    }
    const dirs: string[] = []
    const files: string[] = []
    for (const d of dirents) {
      if (IGNORED_NAMES.has(d.name)) continue
      if (d.isSymbolicLink()) continue // 符号链接不跟进:既是安全边界也防绕环
      if (d.isDirectory()) dirs.push(d.name)
      else if (d.isFile()) files.push(d.name)
    }
    dirs.sort((a, b) => a.localeCompare(b))
    files.sort((a, b) => a.localeCompare(b))
    for (const name of [...files, ...dirs]) {
      if (lines.length >= AGENT_LIST_MAX_ENTRIES) {
        truncated = true
        break
      }
      const isDir = dirs.includes(name)
      const childRel = item.rel ? `${item.rel}/${name}` : name
      lines.push(isDir ? `${childRel}/` : childRel)
      if (isDir && item.depth < AGENT_MAX_DEPTH) {
        queue.push({ abs: join(item.abs, name), rel: childRel, depth: item.depth + 1 })
      }
    }
  }
  if (lines.length === 0) {
    const why = locked > 0 ? `这个文件夹里什么都没列出来(${locked} 个子项打不开)` : '这个文件夹是空的'
    return { ok: true, text: why }
  }
  let text = lines.join('\n')
  const tails: string[] = []
  if (truncated) tails.push(`名单太长,只列了前 ${AGENT_LIST_MAX_ENTRIES} 个`)
  if (locked > 0) tails.push(`${locked} 个子文件夹打不开,跳过了`)
  if (tails.length > 0) text += `\n(${tails.join(';')})`
  return { ok: true, text, hint: `共 ${lines.length} 个` }
}

/**
 * search_content 的执行手(第一百三十九锤):在项目(或某个子文件夹)里按关键词搜,
 * 文件路径和文本文件内容都算,大小写不敏感。内容命中报「文件:行号:那行原文」;
 * 路径命中(文件路径里含关键词,找安装位置类问题的证据)单独记,输出时排最前,
 * 二进制/超大的文件名字对上也照收 —— 名字就是证据,不用翻开看。
 * 缰绳:忽略名单/符号链接/深度跟 list_files 同一份;二进制和超 5MB 的文件内容不读;
 * 扫的文件数、内容命中条数、路径命中条数各自到量就收,照实注明「没搜完」——
 * 绝不让一个关键词把机器烧干。
 * 除喂模型的 text 外,还把结构化命中(matches)一并交回:主进程拿它走旁路推给
 * 界面画「命中清单卡」,格式主动权归程序,不再让小模型当抄写员。
 */
async function agentSearchContent(
  rootPath: string,
  relPath: string,
  keyword: string
): Promise<{ ok: boolean; text: string; hint?: string; matches: AgentSearchMatch[]; matchesTruncated: boolean }> {
  let abs: string
  try {
    abs = await joinAuthorizedRoot(rootPath, relPath)
  } catch {
    return { ok: false, text: `路径越界了(不在项目内):${relPath}`, matches: [], matchesTruncated: false }
  }
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat) return { ok: false, text: `打不开或不存在:${relPath}`, matches: [], matchesTruncated: false }
  if (!stat.isDirectory()) {
    return { ok: false, text: `${relPath} 不是文件夹;搜内容要给文件夹路径(整个项目就传空字符串),单个文件直接用 read_file 读它`, matches: [], matchesTruncated: false }
  }
  const needle = keyword.toLowerCase()
  const scopeLabel = relPath === '' ? '整个项目' : relPath
  const contentMatches: AgentSearchMatch[] = []
  const pathMatches: AgentSearchMatch[] = []
  const queue: Array<{ abs: string; rel: string; depth: number }> = [{ abs, rel: relPath, depth: 0 }]
  let scanned = 0
  let locked = 0
  let filesTruncated = false
  let matchesTruncated = false
  let pathHitsTruncated = false
  outer: while (queue.length > 0) {
    const item = queue[0]
    queue.shift()
    let dirents
    try {
      dirents = await fs.readdir(item.abs, { withFileTypes: true })
    } catch {
      locked += 1
      continue
    }
    for (const d of dirents) {
      if (IGNORED_NAMES.has(d.name)) continue
      if (d.isSymbolicLink()) continue // 符号链接不跟进:既是安全边界也防绕环
      const childRel = item.rel ? `${item.rel}/${d.name}` : d.name
      if (d.isDirectory()) {
        if (item.depth < AGENT_MAX_DEPTH) queue.push({ abs: join(item.abs, d.name), rel: childRel, depth: item.depth + 1 })
        continue
      }
      if (!d.isFile()) continue
      if (scanned >= AGENT_SEARCH_MAX_FILES) {
        filesTruncated = true
        break outer
      }
      // 路径命中:文件路径里含这个词就算,排在内容命中前面(找「xx 装在哪」的证据)。
      // 二进制/超大文件也照收 —— 名字就是证据,不用翻开看
      if (childRel.toLowerCase().includes(needle)) {
        if (pathMatches.length >= AGENT_SEARCH_MAX_PATH_HITS) {
          pathHitsTruncated = true
        } else {
          pathMatches.push({ relPath: childRel, line: 0, text: `路径里含「${keyword}」`, kind: 'path' })
        }
      }
      if (isBinaryFile(childRel)) continue
      const childAbs = join(item.abs, d.name)
      const fstat = await fs.stat(childAbs).catch(() => null)
      if (!fstat || fstat.size > AGENT_FILE_MAX_BYTES) continue
      const raw = await fs.readFile(childAbs, 'utf8').catch(() => null)
      if (raw === null) {
        locked += 1
        continue
      }
      scanned += 1
      if (raw.includes('\u0000')) continue // 后缀骗过名字的混入二进制,照放过
      for (const [index, line] of raw.split('\n').entries()) {
        if (!line.toLowerCase().includes(needle)) continue
        const trimmed = line.trim()
        contentMatches.push({
          relPath: childRel,
          line: index + 1,
          text: trimmed.length > 120 ? `${trimmed.slice(0, 120)}……` : trimmed
        })
        if (contentMatches.length >= AGENT_SEARCH_MAX_MATCHES) {
          matchesTruncated = true
          break outer
        }
      }
    }
  }
  const matches = [...pathMatches, ...contentMatches]
  if (matches.length === 0) {
    let text = `在 ${scopeLabel} 里没搜到「${keyword}」,文件路径和内容都没对上的(翻了 ${scanned} 个文本文件)。可能真没有,也可能藏在二进制/超大的文件里,或者换个更短的关键词再试`
    if (filesTruncated) text += `(文件夹太大,只扫了前 ${AGENT_SEARCH_MAX_FILES} 个文件,没扫完)`
    return { ok: true, text, matches: [], matchesTruncated: false }
  }
  const sections: string[] = []
  if (pathMatches.length > 0) {
    const head = pathHitsTruncated ? `路径对上的文件(只收前 ${AGENT_SEARCH_MAX_PATH_HITS} 个):` : '路径对上的文件:'
    sections.push([head, ...pathMatches.map((m) => m.relPath)].join('\n'))
  }
  if (contentMatches.length > 0) sections.push(['内容对上的(文件:行号:原文):', ...contentMatches.map((m) => `${m.relPath}:${m.line}:${m.text}`)].join('\n'))
  let text = sections.join('\n')
  const tails: string[] = []
  if (matchesTruncated) tails.push(`内容命中太多,只显示前 ${AGENT_SEARCH_MAX_MATCHES} 条`)
  if (pathHitsTruncated) tails.push(`路径命中太多,只收前 ${AGENT_SEARCH_MAX_PATH_HITS} 个`)
  if (filesTruncated) tails.push(`文件夹太大,只扫了前 ${AGENT_SEARCH_MAX_FILES} 个文件,没扫完`)
  if (locked > 0) tails.push(`${locked} 个文件打不开,跳过了`)
  if (tails.length > 0) text += `\n(${tails.join(';')})`
  return { ok: true, text, hint: `${scopeLabel}命中 ${matches.length} 处`, matches, matchesTruncated }
}

/** read_file 的执行手:读文本文件,超长只读开头一段并注明,绝不静默截断 */
async function agentReadFile(
  rootPath: string,
  relPath: string,
  maxChars: number
): Promise<{ ok: boolean; text: string; hint?: string }> {
  let abs: string
  try {
    abs = await joinAuthorizedRoot(rootPath, relPath)
  } catch {
    return { ok: false, text: `路径越界了(不在项目内):${relPath}` }
  }
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat) return { ok: false, text: `打不开或不存在:${relPath}` }
  if (stat.isDirectory()) return { ok: false, text: `${relPath} 是个文件夹不是文件;要看里面有什么,用 list_files 列名单` }
  if (isBinaryFile(relPath)) {
    return { ok: false, text: `${relPath} 是二进制文件,读不了文本内容;这类文件只能看名字猜用途` }
  }
  if (stat.size > AGENT_FILE_MAX_BYTES) {
    return { ok: false, text: `${relPath} 太大了(超过 5MB),不适合整个读;建议让用户在预览里挑一段引用发过来` }
  }
  const raw = await fs.readFile(abs, 'utf8').catch(() => null)
  if (raw === null) return { ok: false, text: `读 ${relPath} 时出了岔子(权限或编码),读不了` }
  if (raw.length === 0) return { ok: true, text: `${relPath} 是个空文件` }
  if (raw.length > maxChars) {
    return {
      ok: true,
      text: `${raw.slice(0, maxChars)}\n……(文件太长,只读了开头约 ${maxChars} 字,全文共 ${raw.length} 字)`,
      hint: `读了开头 ${maxChars} 字 / 全文 ${raw.length} 字`
    }
  }
  return { ok: true, text: raw, hint: `全文 ${raw.length} 字` }
}

async function agentRequestDirectoryAccess(
  event: IpcMainInvokeEvent,
  rawPath: unknown
): Promise<{ ok: boolean; text: string; hint?: string; rootId?: string }> {
  const requested = sanitizeExternalDirectoryPath(rawPath)
  if (requested === null) return { ok: false, text: '目录路径不合法:只能申请用户明确点名的绝对文件夹路径' }
  const canonical = await fs.realpath(requested).catch(() => null)
  if (canonical === null) return { ok: false, text: `这个文件夹不存在或打不开:${requested}` }
  const stat = await fs.stat(canonical).catch(() => null)
  if (!stat?.isDirectory()) return { ok: false, text: `这不是文件夹:${requested}` }
  const existing = agentDirectoryAccess.find(canonical)
  if (existing) {
    return { ok: true, text: `这个文件夹本次运行已经获准。rootId=${existing.rootId};后续只传根内相对路径。`, hint: '本次运行已允许', rootId: existing.rootId }
  }
  const win = BrowserWindow.fromWebContents(event.sender)
  const options = {
    type: 'question' as const,
    title: '允许读取项目外文件夹吗？',
    message: 'AI 想读取这个项目外的文件夹',
    detail: `${canonical}\n\n只读，不会修改文件。允许后仅在本次打开 CodeAtlas 期间有效，关闭应用就失效。`,
    buttons: ['允许本次读取', '拒绝'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
  const choice = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  if (choice.response !== 0) return { ok: false, text: `用户没有允许读取这个文件夹:${canonical}`, hint: '用户拒绝了' }
  const granted = agentDirectoryAccess.grant(canonical)
  if (granted === null) return { ok: false, text: '目录授权失败,没有读取任何项目外文件' }
  return {
    ok: true,
    text: `用户已允许本次运行读取:${granted.path}\nrootId=${granted.rootId};后续调用 list_files/read_file/search_content 时带这个 rootId,路径只写根内相对路径。`,
    hint: '本次运行已允许',
    rootId: granted.rootId
  }
}

/**
 * web_search 的执行手(联网锤):搜索 + 第一条正文节选。源队列在 weblookup.ts 纯函数层
 * (Tavily 有 Key 打头 → DDG → 维基中 → 维基英),三道闸(搜索词安检/内网闸/防上当声明)
 * 也都扎在那边,这边只管跑和报。查不到不报错:照实告诉模型没查到,让它用已有的知识答并注明拿不准。
 */
async function agentWebSearch(query: string, tavilyKey: string | undefined): Promise<{ ok: boolean; text: string; hint?: string }> {
  const found = await webSearchDetailed(query, { fetchText: electronFetchText, postJson: electronPostJson, tavilyKey })
  if (found.material === '') {
    return { ok: false, text: '没查到有用的资料(可能断网、被限流或词太生僻):就用你已经知道的先答,答不准就明说拿不准', hint: '没查到' }
  }
  return { ok: true, text: found.material, hint: found.sources.join('、') }
}

/** 每翻一样就往界面播一句大白话(挂在流式增量通道上,渲染层认 step 字段) */
function sendAgentStep(event: IpcMainInvokeEvent, requestId: string, text: string): void {
  if (requestId === '' || event.sender.isDestroyed()) return
  const payload: AiDeltaPayload = { id: requestId, text: '', step: { text } }
  event.sender.send(CH.aiDelta, payload)
}

/**
 * 命中清单卡走旁路(LLM 优化锤):search_content 搜到的结构化命中直接推给界面画卡,
 * 每条「文件:行号:原文」原样到用户眼前、可点跳转 —— 不再让小模型当抄写员,
 * 一条不丢、行号一个不错。只走内存通道,零落盘。
 */
function sendAgentMatches(event: IpcMainInvokeEvent, requestId: string, card: AgentSearchCard): void {
  if (requestId === '' || event.sender.isDestroyed()) return
  const payload: AiDeltaPayload = { id: requestId, text: '', matches: card }
  event.sender.send(CH.aiDelta, payload)
}

/** agent 流式轮次的增量转发(第一百三十四锤):思考/正文逐帧推给界面,token 账同帧喂状态条 */
function sendAgentDelta(event: IpcMainInvokeEvent, requestId: string, ev: AgentStreamEvent): void {
  if (requestId === '' || event.sender.isDestroyed()) return
  const payload: AiDeltaPayload = { id: requestId, text: ev.text ?? '' }
  if (ev.reasoning) payload.reasoning = ev.reasoning
  if (ev.stats) payload.stats = ev.stats
  if (ev.reset) payload.reset = true
  if (ev.seal) payload.seal = true
  event.sender.send(CH.aiDelta, payload)
  // 引擎肯报账,状态条的「忙」就跟着报数(和普通聊天同一待遇)
  if (ev.stats) announceActivityBusy(lastActivityProvider, ev.stats)
}

/**
 * 翻文件模式里「不认工具调用」的引擎黑名单(第一百四十锤,只记会话内存,零落盘):
 * 键 = baseUrl|模型名。有的外接服务(甚至不带工具模板的模型文件)收到 tools 字段
 * 直接甩 400,循环还没起步就断 —— 摔过一跤的记下来,下次直接按普通对话回答,
 * 不再拿石头砸自己的脚。
 */
const noToolEngines = new Set<string>()

/**
 * 翻文件模式的工具循环:模型喊工具 → 主进程沙盒里执行 → 结果喂回 → 循环,
 * 直到模型交出不带工具调用的正文答案。缰绳三根:轮数封顶(到顶后撤掉工具表
 * 逼它交卷)、同一样东西不许翻第二遍、每轮之间都听用户的取消。
 * 模型不会喊工具也没关系:第一轮就交正文,当普通回答返回 —— 不装 agent 空转。
 */
async function runAgentChat(input: {
  event: IpcMainInvokeEvent
  requestId: string
  target: ChatTarget
  systemPrompt: string
  baseMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  rootPath: string
  ctx: number
  replyCap: number
  allowThinking: boolean
  signal: AbortSignal
  startedAt: number
  webLookup: WebLookupMeta
  /** 联网查证开着 = 工具表里多一件 web_search,人设后面多垫一段上网守则 */
  webSearchEnabled: boolean
  /** Tavily 的 Key(可选):填了 web_search 的源队列 Tavily 打头(2026-09-17 小葵定) */
  tavilyKey?: string
}): Promise<AiChatResult> {
  const { event, requestId, target, baseMessages, rootPath, ctx, replyCap, allowThinking, signal } = input
  const messages: AgentChatMessage[] = [...baseMessages]
  // 本轮用户真正的问题 = 组装消息里最后一条 user(附件/摘要/历史都垫在它前面);
  // 每轮工具结果后垫提醒卡时引用它,把正事重新钉在模型眼皮底下。
  // 剥掉注意力锚(答旧题修复·刀三):提醒卡引用的是干净的问题原文,标牌不进提醒
  let currentQuestion = ''
  for (let i = baseMessages.length - 1; i >= 0; i--) {
    const m = baseMessages[i]
    if (m.role === 'user') {
      currentQuestion = stripCurrentQuestionAnchor(m.content)
      break
    }
  }
  // 这引擎摔过「不认工具调用」的跤就直接按普通对话走,连守则都不垫
  const engineKey = `${target.baseUrl}|${target.model}`
  let engineNoTools = noToolEngines.has(engineKey)
  if (engineNoTools) {
    sendAgentStep(event, requestId, '这个模型不会自己翻文件(不支持工具调用),按普通对话回答')
  }
  // 人设后面垫翻文件切片(prompts.ts 的逐字稿):教它现在有什么手脚;
  // 联网查证开着再垫一段上网守则(模型这才知道有 web_search)。拆除兜底认同一把尺子,别拆岔了
  // (旧 AGENT_ADDENDUM 自带开头的 \n\n,新切片没带 —— 在这里拼进去,摘除时 endsWith+slice 连分隔符一起裁)
  const addendum = `\n\n${AGENT_FILES_ADDENDUM}${input.webSearchEnabled ? AGENT_WEB_ADDENDUM : ''}`
  const systemIdx = messages.findIndex((m) => m.role === 'system')
  if (systemIdx >= 0) {
    const sysContent = (messages[systemIdx] as { content: string }).content
    // 黑名单引擎也得给句准话:agent 底座(buildChatSystem({agent:true}))里没有「没手脚」切片,
    // 什么都不垫,模型会照旧吹自己翻过项目 —— 改垫无工具切片,明说本轮没有翻文件能力
    messages[systemIdx] = {
      role: 'system',
      content: engineNoTools ? `${sysContent}\n\n${SLICE_NO_TOOLS}` : `${sysContent}${addendum}`
    }
  }
  const readChars = agentReadChars(ctx)
  const doneCalls = new Set<string>()
  // 提醒卡门槛和质检闸前置的共同账本:本场实际执行成功的工具调用次数
  // (参数不合法被拒、防打转被拦的都不算 —— 没真翻过就别拿提醒卡烦它)
  let toolCallsExecuted = 0
  // 质检闸的账本:本场真执行过 search_content 没有、搜到的文件路径(答案引用对账用)、
  // 已经拦了几次(封顶两次,掰不过来就随它交卷)
  let searchUsed = false
  const searchHitPaths = new Set<string>()
  let salvageNudges = 0
  // 工具结果 id → 防打转记账键的对照表:旧资料被压缩成纸条时,按它解锁重读
  const callIdToKey = new Map<string, string>()
  const promptBudget = agentPromptBudget(ctx, replyCap)
  let usage: AiUsage | undefined
  let reasoningAll: string | undefined
  // 封板账(第一百五十一锤):中间轮的话一旦封成独立气泡,思考过程也按轮各归各 ——
  // 早轮的思考已经随流躺在各自封口气泡里,结果里只回最后一轮的;没封过板照旧回全场总账
  let lastRoundReasoning: string | undefined
  let sealedAny = false
  const resultReasoning = (): string | undefined => (sealedAny ? lastRoundReasoning : reasoningAll)
  let rounds = 0
  // 兜底降级后的重答轮不算「轮数烧完」,别把逼卷令也塞进去
  let skipNudgeOnce = false
  // 提醒卡兜底只许用一次:撤卡重答还 4xx 就不是卡的锅了,照实报错
  let reminderFailsafe = false
  // 复读机兜底也只许用一次:重说还打转就截断交卷,不无限跟它耗
  let repetitionRetried = false
  // 紧急瘦身也只许用一次:裁旧账重试还爆,就是这锅真装不下,照实报错
  let slimRetried = false
  addDevLog('request', `翻文件模式开跑 · 最多 ${AGENT_MAX_ROUNDS} 轮 · 单次读文件约 ${readChars} 字 · 压缩警戒线约 ${promptBudget} tokens`)
  for (;;) {
    if (signal.aborted) return agentResult(input, 'cancelled', '', usage, resultReasoning())
    // 锅快满了先腾地方(第一百三十八锤):早先翻看的大段原文提炼成占位纸条,
    // 最近的留原样;被压掉的按对照表解锁「不许翻第二遍」,模型要重温随时能重读
    const compressed = compressAgentMessages(messages, promptBudget)
    if (compressed) {
      for (const callId of compressed.freedCallIds) {
        const key = callIdToKey.get(callId)
        if (key) doneCalls.delete(key)
      }
      messages.splice(0, messages.length, ...compressed.messages)
      sendAgentStep(event, requestId, `对话快记满了,把较早翻看的 ${compressed.compressedCount} 样旧资料提炼成了占位纸条 —— 要重温随时能再翻`)
      addDevLog('request', `翻文件第 ${rounds + 1} 轮前压缩:${compressed.compressedCount} 条旧资料成了纸条,腾出约 ${compressed.freedCallIds.length} 处重读权`)
    }
    const useTools = !engineNoTools && rounds < AGENT_MAX_ROUNDS
    // 逼卷令只在「真烧完了轮数」时发;引擎天生不支持工具或刚兜底降级的,发这话是驴唇不对马嘴
    if (rounds >= AGENT_MAX_ROUNDS && !skipNudgeOnce) messages.push({ role: 'user', content: ROUND_CAP_NUDGE })
    skipNudgeOnce = false
    rounds += 1
    const round = await agentRound(target, messages, {
      signal,
      maxTokens: replyCap,
      allowThinking,
      useTools,
      webSearchEnabled: input.webSearchEnabled,
      onDelta: (ev) => {
        if (ev.seal) sealedAny = true
        sendAgentDelta(event, requestId, ev)
      }
    })
    lastRoundReasoning = round.status === 'ok' ? round.reasoning : undefined
    if (round.status !== 'ok') {
      // 复读机兜底(第一百四十三锤):流式尾巴连着打转 —— agentRound 已发 reset 令收回
      // 已吐的字。掐了重说一轮(只兜一次);重说还打转就截到打转起点,拿剩下的交卷,
      // 绝不把一屏望不到头的循环递给用户
      if (round.status === 'repetition') {
        if (!repetitionRetried) {
          repetitionRetried = true
          skipNudgeOnce = true // 重答这轮不算「轮数烧完」,别把逼卷令也捎上
          sendAgentStep(event, requestId, '回答说到半截开始原地打转,掐掉重说一遍')
          continue
        }
        const text = (truncateAtRepetition(round.text) ?? round.text).trim()
        if (text === '') {
          return agentResult(input, 'error', '模型连着两回都说到一半原地打转 —— 换个问法重新问问看', usage, resultReasoning())
        }
        sendAgentStep(event, requestId, '重说了一回还在原地打转,把打转的部分掐了,先把说完的交给你')
        return agentResult(input, 'supported', text, usage, resultReasoning())
      }
      // 兜底(第一百四十锤):引擎不认工具调用(甩 400/404/422 还点名 tools)——
      // 记进会话黑名单,拆掉人设里垫的守则,这轮按普通对话重答;只兜一次,
      // 普通请求再出错照实报给用户
      if (round.status === 'error' && round.toolsUnsupported === true && useTools && !engineNoTools) {
        noToolEngines.add(engineKey)
        engineNoTools = true
        skipNudgeOnce = true
        sendAgentStep(event, requestId, '这个模型不支持自己翻文件(工具调用),这轮先按普通对话回答 —— 想用翻文件模式,得换个支持工具调用的模型')
        const sysIdx = messages.findIndex((m) => m.role === 'system')
        if (sysIdx >= 0) {
          let sysContent = (messages[sysIdx] as { content: string }).content
          if (sysContent.endsWith(addendum)) sysContent = sysContent.slice(0, -addendum.length)
          // 切片摘走后,人设里什么能力声明都没剩 —— 补一段「没手脚」切片,别让它空口吹翻过项目。
          // includes 保险:起手黑名单分支理论上和这里互斥,但万一已经垫过就不重复加
          if (!sysContent.includes(SLICE_NO_TOOLS)) sysContent = `${sysContent}\n\n${SLICE_NO_TOOLS}`
          messages[sysIdx] = { role: 'system', content: sysContent }
        }
        continue
      }
      // 提醒卡兜底:个别外接引擎不认「tool 结果后面跟 user 消息」的形态,甩 4xx ——
      // 撤掉提醒卡退回无卡形态重答一轮(只兜一次);再错就照实报给用户,不跟它耗
      if (
        round.status === 'error' &&
        !reminderFailsafe &&
        (round.httpStatus === 400 || round.httpStatus === 404 || round.httpStatus === 422) &&
        messages.some((m) => m.role === 'user' && m.content.startsWith(AGENT_REMINDER_PREFIX))
      ) {
        reminderFailsafe = true
        skipNudgeOnce = true
        messages.splice(0, messages.length, ...messages.filter((m) => !(m.role === 'user' && m.content.startsWith(AGENT_REMINDER_PREFIX))))
        sendAgentStep(event, requestId, '这个模型不太习惯多出来的小纸条,撤掉重答')
        continue
      }
      // 紧急瘦身兜底:轮间的纸条压缩是保养,服务直接甩「上下文装不下」拒收时只有整段裁旧账能救 ——
      // 只保 system 和最新真问题(400 拒收时模型一个字没吐,重试不重影);只兜一次,再爆就照实报错
      if (round.status === 'error' && isContextOverflow(round.text) && !slimRetried) {
        slimRetried = true
        const slimmed = emergencySlim(messages)
        if (slimmed) {
          messages.splice(0, messages.length, ...slimmed.messages)
          // 旧账清了,防打转的账本跟着清:被裁掉结果的旧工具调用,模型要重温得允许重翻
          doneCalls.clear()
          callIdToKey.clear()
          skipNudgeOnce = true
          sendAgentStep(event, requestId, `对话把模型的脑容量撑爆了:把翻看前的旧账整段清掉(约 ${slimmed.dropped} 条),保住你最新的问题,重答一遍`)
          continue
        }
      }
      return agentResult(input, round.status === 'cancelled' ? 'cancelled' : 'error', round.text, usage, resultReasoning())
    }
    usage = mergeUsage(usage, round.usage)
    if (round.reasoning) reasoningAll = reasoningAll ? `${reasoningAll}\n\n${round.reasoning}` : round.reasoning
    // 状态条的实时计数是流式增量顺手喂的,翻文件按轮非流式没增量可蹭 ——
    // 每轮收完账自己报一次,左下角不至于整场只挂「在干活……」
    if (usage) {
      announceActivityBusy(lastActivityProvider, {
        phase: 'writing',
        promptTokens: usage.promptTokens,
        outputTokens: usage.outputTokens,
        tokensPerSecond: usage.tokensPerSecond
      })
    }
    const raw = round.raw
    const calls = useTools ? extractToolCalls(raw) : []
    if (calls.length === 0 || !useTools) {
      const text = (raw.content ?? '').trim()
      if (text === '') {
        return agentResult(input, 'error', '模型翻是翻了,但最后一句话没说出来 —— 再问一次试试', usage, resultReasoning())
      }
      // 质检闸(救敷衍):找位置题的答案交卷前过两道判据 —— 一次文件都没搜过(逼它先搜)、
      // 搜到了东西却一个具体文件都不引用(逼它把文件写进答案,答案里可点跳转的链接全靠这个)。
      // 拦下重答(先收回已吐的字再垫补救提醒),封顶两次,掰不过来就随它交卷,不无限跟它耗;
      // 轮数已烧完的逼卷轮不拦 —— 那轮它没工具可调,拦了也白拦
      // 前置条件(提示词体系重写第二批):本场一个工具调用都没发生过就直接放行,连 no-search 也不拦 ——
      // 模型一口答出来的题(概念题、闲聊),质检闸没资格逼它先翻文件
      if (useTools && toolCallsExecuted > 0 && salvageNudges < SALVAGE_NUDGE_MAX && rounds < AGENT_MAX_ROUNDS) {
        const gap = findAnswerGap({
          isFindQuestion: isFindQuestion(currentQuestion),
          searchUsed,
          hitPaths: [...searchHitPaths],
          answer: text
        })
        if (gap) {
          salvageNudges += 1
          skipNudgeOnce = true
          messages.push(raw)
          messages.push({ role: 'user', content: gap === 'no-search' ? SALVAGE_SEARCH_NUDGE : SALVAGE_CITE_NUDGE })
          sendResetDelta(event, requestId)
          sendAgentStep(
            event,
            requestId,
            gap === 'no-search'
              ? '这题是找东西,它一次文件都没搜就想交卷 —— 程序拦下,让它先搜再答'
              : '答案里没落到具体文件 —— 程序拦下,让它把搜到的文件写进答案再交'
          )
          continue
        }
      }
      addDevLog('request', `翻文件收工 · 第 ${rounds} 轮交卷 · 输出约 ${text.length} 字`)
      return agentResult(input, 'supported', text, usage, resultReasoning())
    }
    // 工具调用原样回填进对话(服务端要求 assistant 消息和 tool 结果成对出现)
    messages.push(raw)
    const toolResults: Array<{ role: 'tool'; tool_call_id: string; content: string }> = []
    for (const call of calls) {
      if (signal.aborted) break
      const callName = asToolName(call.name)
      const isFileTool = callName === TOOL_NAMES.readFile || callName === TOOL_NAMES.listFiles || callName === TOOL_NAMES.searchContent
      const selectedRoot = isFileTool ? agentDirectoryAccess.resolve(rootPath, call.args?.rootId) : null
      const relPath =
        callName === TOOL_NAMES.webSearch || callName === TOOL_NAMES.requestDirectoryAccess
          ? ''
          : callName === TOOL_NAMES.searchContent && call.args?.relPath === undefined
            ? ''
            : sanitizeAgentRelPath(call.args?.relPath)
      const keyword = callName === TOOL_NAMES.searchContent && typeof call.args?.keyword === 'string' ? call.args.keyword.trim().slice(0, 200) : ''
      const rawQuery = call.args?.query
      const requestedPath = callName === TOOL_NAMES.requestDirectoryAccess ? sanitizeExternalDirectoryPath(call.args?.path) : null
      // web_search 的搜索词走自己的安检(隐私闸):空词/超长/带路径样的一律拒收
      const query = callName === TOOL_NAMES.webSearch ? sanitizeWebQuery(rawQuery) : null
      const queryMissing = callName === TOOL_NAMES.webSearch && (typeof rawQuery !== 'string' || rawQuery.trim() === '')
      if (
        !callName ||
        relPath === null ||
        (isFileTool && selectedRoot === null) ||
        (callName === TOOL_NAMES.searchContent && keyword === '') ||
        (callName === TOOL_NAMES.requestDirectoryAccess && requestedPath === null) ||
        (callName === TOOL_NAMES.webSearch && query === null)
      ) {
        const why = !callName
          ? '没有这个工具'
          : isFileTool && selectedRoot === null
            ? '目录编号无效或尚未获准,项目外目录要先申请'
            : callName === TOOL_NAMES.requestDirectoryAccess
              ? '要给用户明确点名的绝对文件夹路径(path)'
              : callName === TOOL_NAMES.webSearch
                ? queryMissing
                  ? '要给搜索词(query),写概念词、软件名或短的公开问题'
                  : '搜索词不合法:别把本地路径、代码或超长文字当搜索词,换几个公开的关键词再试'
                : callName === TOOL_NAMES.searchContent
                  ? '要给关键词(keyword),如 500 或 DWELL_MS'
                  : '路径不合法,要用所选根目录内的相对路径'
        const badTarget =
          callName === TOOL_NAMES.webSearch
            ? String(rawQuery ?? '(没给搜索词)')
            : callName === TOOL_NAMES.requestDirectoryAccess
              ? String(call.args?.path ?? '(没给目录)')
              : String(call.args?.keyword ?? call.args?.relPath ?? call.args?.rootId ?? '(没给参数)')
        sendAgentStep(event, requestId, agentStepText(callName ?? TOOL_NAMES.listFiles, badTarget, 'error', why))
        toolResults.push({ role: 'tool', tool_call_id: call.id, content: wrapToolResult(`参数不合法:${why}`) })
        continue
      }
      // 防打转键:search 带上关键词、web_search 带上搜索词 —— 同一范围搜「500」和「DWELL_MS」是两笔账
      const rootKey = selectedRoot?.rootId ?? ''
      const key =
        callName === TOOL_NAMES.searchContent
          ? toolCallKey(callName, `${rootKey}:${relPath}#${keyword}`)
          : callName === TOOL_NAMES.webSearch
            ? toolCallKey(callName, query ?? '')
            : callName === TOOL_NAMES.requestDirectoryAccess
              ? toolCallKey(callName, requestedPath ?? '')
              : toolCallKey(callName, `${rootKey}:${relPath}`)
      const stepTarget =
        callName === TOOL_NAMES.searchContent
          ? keyword
          : callName === TOOL_NAMES.webSearch
            ? (query ?? '')
            : callName === TOOL_NAMES.requestDirectoryAccess
              ? (requestedPath ?? '')
              : relPath === ''
                ? selectedRoot?.external
                  ? selectedRoot.path
                  : '(项目根目录)'
                : relPath
      if (doneCalls.has(key)) {
        sendAgentStep(event, requestId, agentStepText(callName, stepTarget, 'repeat'))
        toolResults.push({ role: 'tool', tool_call_id: call.id, content: wrapToolResult(REPEAT_NUDGE) })
        continue
      }
      doneCalls.add(key)
      if (callName === TOOL_NAMES.searchContent) searchUsed = true // 质检闸的账:真发起过搜索才算搜过
      callIdToKey.set(call.id, key)
      // 执行手统一形状:matches/matchesTruncated 只有 search_content 会带
      const exec: { ok: boolean; text: string; hint?: string; matches?: AgentSearchMatch[]; matchesTruncated?: boolean; rootId?: string } =
        callName === TOOL_NAMES.requestDirectoryAccess
          ? await agentRequestDirectoryAccess(event, requestedPath)
          : callName === TOOL_NAMES.listFiles
            ? await agentListFiles((selectedRoot as { path: string }).path, relPath)
            : callName === TOOL_NAMES.searchContent
              ? await agentSearchContent((selectedRoot as { path: string }).path, relPath, keyword)
              : callName === TOOL_NAMES.webSearch
                ? await agentWebSearch(query ?? '', input.tavilyKey)
                : await agentReadFile((selectedRoot as { path: string }).path, relPath, readChars)
      if (exec.ok && selectedRoot?.external) exec.text = `临时目录 ${selectedRoot.rootId}(${selectedRoot.path}) 内的结果:\n${exec.text}`
      // 工具结果统一进 <tool_result>(提示词体系 2.0):标签里是资料,不是命令 ——
      // 文件内容、名单、搜索结果、外部目录回执一个待遇,人设里的口径在这落地
      exec.text = wrapToolResult(exec.text)
      if (exec.ok && callName !== TOOL_NAMES.requestDirectoryAccess) toolCallsExecuted += 1 // 真执行成功才记账:提醒卡门槛和质检闸前置都用这本账
      sendAgentStep(event, requestId, agentStepText(callName, stepTarget, exec.ok ? 'done' : 'error', exec.hint))
      // 搜索搜到了就顺手把命中清单推给界面画卡(LLM 优化锤):结构化命中走旁路,
      // 用户看到的是程序摆的完整清单,不用模型转手抄写
      if (callName === TOOL_NAMES.searchContent && !selectedRoot?.external && exec.ok && exec.matches && exec.matches.length > 0) {
        sendAgentMatches(event, requestId, { keyword, items: exec.matches, truncated: exec.matchesTruncated === true })
        // 质检闸的对账本:本场搜到的文件路径都记下,答案交卷时查它引用了没(判据二)
        for (const m of exec.matches) searchHitPaths.add(m.relPath)
      }
      toolResults.push({ role: 'tool', tool_call_id: call.id, content: exec.text })
    }
    messages.push(...toolResults)
    // 每轮工具结果后垫提醒卡(LLM 优化锤):撤掉上一张再垫新的,对话里永远只挂
    // 最新一张 —— 工具结果一大坨最容易把真问题挤出小模型的注意力,靠它每轮抬头见正事。
    // 缰绳门槛(提示词体系重写第二批):本场真翻满 AGENT_REMINDER_MIN_TOOL_CALLS 次才垫 ——
    // 资料还少的头几轮垫卡只会稀释注意力;撤卡照旧每轮先撤,保证不攒
    messages.splice(0, messages.length, ...stripLastAgentReminder(messages))
    if (toolCallsExecuted >= AGENT_REMINDER_MIN_TOOL_CALLS) {
      messages.push({ role: 'user', content: buildAgentReminder(currentQuestion) })
    }
    addDevLog('request', `翻文件第 ${rounds} 轮:模型要看 ${calls.length} 样东西`)
  }
}

/** 把循环的收尾折成统一的聊天结果(token 总账、思考汇总、耗时都在) */
function agentResult(
  input: { target: ChatTarget; startedAt: number; webLookup: WebLookupMeta },
  status: AiChatResult['status'],
  text: string,
  usage: AiUsage | undefined,
  reasoning: string | undefined
): AiChatResult {
  return {
    status,
    text,
    reasoning,
    model: input.target.model,
    durationMs: Date.now() - input.startedAt,
    usage,
    webLookup: input.webLookup
  }
}

function registerIpc(): void {
  // 自绘窗口壳的三颗灰点:关 / 最小化 / 最大化切换。渲染进程不许直接碰 BrowserWindow,一律走这儿
  ipcMain.handle(CH.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle(CH.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle(CH.windowMaximizeToggle, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle(CH.windowIsMaximized, (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)

  // 弹出系统"选择文件夹"对话框,返回所选路径;取消则返回 null
  // 第八十八锤:对话框认准来叫它的那个窗,不再抓「[0]」——日志窗开着时别把弹窗挂错门
  ipcMain.handle(CH.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = { properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // 列盘符(第六十锤):只问 Windows「有哪些盘」,不翻任何文件内容,秒回。
  // 跳过 A/B(软驱遗物,探测可能卡好几秒);容量用 statfs 一次系统调用,拿不到就只给盘符
  // 列盘符(第八十一锤加固,第八十二锤瘦身):①所有盘一起问、单盘 2.5 秒不答就当缺席 ——
  // 掉线的网络映射盘以前能拖住整列;②盘的来路(固定/移动/网络/光驱)一次 PowerShell 问齐,
  // 失败/超时就当没有,盘卡片照常按老样子叫「本地磁盘」,基本面不受影响(带 5 秒小缓存,
  // 回首页重列盘符时不用次次都起 PowerShell)。卷标不再问 —— 小葵拍板:盘就认大写字母,直白
  ipcMain.handle(CH.listDrives, async (): Promise<DriveInfo[]> => {
    /** 单个询问加超时:到点回 null,慢半拍的输家就地安静,不许变未处理的拒绝 */
    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const bell = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms)
      })
      p.catch(() => null)
      return Promise.race([p.catch(() => null), bell]).finally(() => {
        if (timer) clearTimeout(timer)
      })
    }

    const probeLetter = async (ch: string): Promise<DriveInfo | null> => {
      const root = `${ch}:\\`
      const exists = await withTimeout(fs.stat(root).then(() => true, () => false), 2500)
      if (!exists) return null
      const info: DriveInfo = { letter: ch, root }
      const usage = await withTimeout(
        fs.statfs(root).then((s) => ({ free: s.bsize * s.bfree, total: s.bsize * s.blocks })),
        2500
      )
      if (usage) {
        info.free = usage.free
        info.total = usage.total
      }
      return info
    }

    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    const drives = (await Promise.all(letters.map(probeLetter))).filter((d): d is DriveInfo => d !== null)
    const kinds = await queryDriveKinds()
    if (kinds) {
      for (const d of drives) {
        const kind = kinds.get(d.letter)
        if (kind) d.kind = kind
      }
    }
    return drives
  })

  // 渲染层拿不到 app 版本,给个小通道(设置里的版本信息行用)
  ipcMain.handle(CH.appVersion, () => app.getVersion())

  // ── Developer 日志(第八十七锤):拉全量 / 清账 / 开窗 ──
  ipcMain.handle(CH.devLogPull, () => devLogSnapshot())
  ipcMain.handle(CH.devLogClear, () => {
    clearDevLogs()
  })
  ipcMain.handle(CH.devLogOpen, () => {
    openDevLogWindow()
  })

  // 扫描指定文件夹,返回目录树 + 统计;顺手给每个节点打大白话速览标签
  ipcMain.handle(CH.scanFolder, async (_event, folderPath: unknown) => {
    if (typeof folderPath !== 'string' || folderPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    const root = folderPath.trim()
    // 地址栏手输的路径先验明正身:不存在 / 填的是文件,都得说人话,别吐 ENOENT 生面孔
    const stat = await fs.stat(root).catch((err: NodeJS.ErrnoException) => err)
    if (stat instanceof Error) {
      if (stat.code === 'ENOENT') {
        throw new Error(`找不到这个文件夹:${root} —— 检查一下盘符、拼写和斜杠方向;不确定的话,用「选择文件夹」点一个最稳`)
      }
      throw new Error(accessDeniedMessage(stat, '文件夹', root))
    }
    if (!stat.isDirectory()) {
      // 手滑填了文件路径:顺手把上一层文件夹指给他看
      const parent = root.replace(/[\\/]+[^\\/]+$/, '') || root
      throw new Error(`这个路径是一个文件,不是文件夹 —— 要填装它的那层文件夹,比如:${parent}`)
    }
    const result = scanDirectory(root)
    return result.then((r) => {
      annotateSummaries(r.tree)
      return r
    })
  })

  // 分级扫描:点开某个还没探的子文件夹,只探这一层(预算内收工),返回子树 + 这一份统计
  ipcMain.handle(CH.scanSubdir, (_event, rootPath: unknown, relPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '' || typeof relPath !== 'string') {
      throw new Error('参数不合法')
    }
    // 路径契约:绝对路径拼接只走 joinRoot;子树 relPath 必须带全项目前缀,拼回大树才不断链
    const result = scanDirectory(joinRoot(rootPath, relPath), relPath)
    return result.then((r) => {
      annotateSummaries(r.tree)
      return r
    })
  })

  // AST 分析单个文件;不支持的语言/超大文件返回 null(诚实的能力边界,不是出错)
  // 路径契约:收 (rootPath, relPath),绝对路径只能由 joinRoot 在这儿解析
  ipcMain.handle(CH.analyzeFile, async (_event, rootPath: unknown, relPath: unknown, languageId: unknown) => {
    if (typeof rootPath !== 'string' || typeof relPath !== 'string' || typeof languageId !== 'string') {
      throw new Error('参数不合法')
    }
    if (!isAnalysisSupported(languageId)) return null
    const absPath = joinRoot(rootPath, relPath) // relPath 想越界(.. 上跳、盘符注入)会在这里被拦
    const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
    if (stat instanceof Error) {
      throw new Error(accessDeniedMessage(stat, '文件', relPath))
    }
    if (!stat.isFile()) {
      throw new Error(`这个路径不是一个文件:${relPath}`)
    }
    if (stat.size > SOURCE_PARSE_MAX_BYTES) return null // 超过上限的源码不解析,避免卡顿
    const code = await fs.readFile(absPath, 'utf8').catch((err: NodeJS.ErrnoException) => {
      throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
    })
    return analyzeSource(code, languageId)
  })

  // 代码预览读文件(第一百一十锤):右键「预览文件」用的那条通道。
  // 路径契约同 analyze-file —— 收 (rootPath, relPath),绝对路径只经 joinRoot 解析,
  // relPath 越界(.. 上跳、盘符注入)在这儿被拦。守卫三道:二进制不受理、超大不受理、
  // 能读的也只给前一段(行数/字数双封顶),账目如实回给界面,绝不静默腰斩。
  ipcMain.handle(CH.readPreview, async (_event, rootPath: unknown, relPath: unknown): Promise<FilePreviewResult> => {
    if (typeof rootPath !== 'string' || typeof relPath !== 'string') {
      throw new Error('参数不合法')
    }
    const absPath = joinRoot(rootPath, relPath)
    const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
    if (stat instanceof Error) {
      throw new Error(accessDeniedMessage(stat, '文件', relPath), { cause: stat })
    }
    if (!stat.isFile()) {
      throw new Error(`这个路径不是一个文件:${relPath}`)
    }
    const name = relPath.split('/').pop() ?? relPath
    // 后缀一看就是二进制/媒体的,连读都不用读
    if (isBinaryFile(name)) {
      return { status: 'binary', text: '', totalLines: 0, reason: '这是二进制或媒体文件,里面没有能当文本看的字;想了解它的话,右栏的小探针可以按类型给你讲' }
    }
    if (stat.size > PREVIEW_MAX_BYTES) {
      return {
        status: 'too-big',
        text: '',
        totalLines: 0,
        reason: `这个文件有 ${formatSize(stat.size)},太大了,预览只伺候 ${formatSize(PREVIEW_MAX_BYTES)} 以内的文本`
      }
    }
    // 读内容也可能撞上独占/上锁(EBUSY/EPERM),走人话口径,不吐生面孔
    const buf = await fs.readFile(absPath).catch((err: NodeJS.ErrnoException) => {
      throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
    })
    // 后缀骗人的(改名的二进制)在这儿补一道:开头有 NUL 字节就不是文本
    if (looksBinary(buf.subarray(0, 8192))) {
      return { status: 'binary', text: '', totalLines: 0, reason: '这个文件的内容不是文本(开头就是二进制数据),预览不了' }
    }
    const clip = clipPreview(buf.toString('utf8'))
    // 预览分色(这锤):顺手让 tree-sitter 把代码过一遍。超闸、不认识的语言、
    // 解析出错都老实回 null —— 界面白字照常,分色永远不拖累预览本身。
    const colors = await highlightSource(clip.text, name)
    return { status: 'ok', text: clip.text, totalLines: clip.totalLines, colors: colors ?? undefined, reason: '' }
  })

  // 项目关系图:全项目谁引用谁。路径契约同 analyze-file,读文件只走 joinRoot
  ipcMain.handle(CH.depGraph, (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    return buildDependencyGraph(rootPath)
  })

  // 外观偏好:读 / 存(2026-09-16 起从 localStorage 搬进 appearance.json —— 那份按
  // localhost 端口分仓、端口一挤就出厂设置的存档方式退役)。同步读通道是给 preload
  // 首帧用的:页面脚本跑之前就得定外观,不然先按默认画一帧再换皮,界面会闪。
  ipcMain.on(CH.appearanceGetSync, (event) => {
    event.returnValue = loadAppearanceFileSync(app.getPath('userData'))
  })
  ipcMain.handle(CH.appearanceSave, (_event, raw: unknown) => {
    const a = sanitizeAppearance(raw)
    return saveAppearanceFile(app.getPath('userData'), a)
  })

  // 模型货架:实时榜(只读抱抱脸公开 API,零落盘)+ 某仓库的文件清单。拉货手在 ai/modelShelf
  ipcMain.handle(CH.modelShelf, () => fetchModelShelf())
  ipcMain.handle(CH.modelFiles, (_event, repoId: unknown) => {
    if (typeof repoId !== 'string' || repoId === '') throw new Error('参数不合法')
    return fetchRepoFiles(repoId)
  })

  // 模型下载(一键到位):货架点文件 → 断点续传拉到 userData/models → 自动填进 AI 配置。
  // 下载是长活,进度走事件推送;窗口可能还没建好/已关,win 取当下最新的主窗,拿不到就静默下
  ipcMain.handle(CH.modelDownloadStart, async (_event, args: unknown) => {
    if (typeof args !== 'object' || args === null) throw new Error('参数不合法')
    const { repoId, filePath } = args as Record<string, unknown>
    if (typeof repoId !== 'string' || typeof filePath !== 'string') throw new Error('参数不合法')
    const win = BrowserWindow.getAllWindows()[0] ?? null
    const finalPath = await startModelDownload({ win, userDataDir: app.getPath('userData'), repoId, filePath })
    await pointConfigAtModel(app.getPath('userData'), finalPath)
    return finalPath
  })
  ipcMain.handle(CH.modelDownloadCancel, () => cancelModelDownload())

  // AI 配置:读 / 存(双 Provider:lmstudio 与 builtin 两个分支都收)
  ipcMain.handle(CH.aiConfigGet, () => loadAiConfig(app.getPath('userData')))
  ipcMain.handle(CH.aiConfigSave, async (_event, config: unknown) => {
    if (typeof config !== 'object' || config === null) throw new Error('配置不合法')
    const c = config as Partial<AiConfig>
    const lm = c.lmstudio
    const bi = c.builtin
    if (
      !lm || typeof lm.baseUrl !== 'string' || typeof lm.model !== 'string' ||
      !bi || typeof bi.serverPath !== 'string' || typeof bi.modelPath !== 'string'
    ) {
      throw new Error('配置不合法:缺 lmstudio / builtin 设置')
    }
    const previous = await loadAiConfig(app.getPath('userData'))
    const saved = await saveAiConfig(app.getPath('userData'), {
      provider: c.provider === 'builtin' ? 'builtin' : 'lmstudio',
      lmstudio: { baseUrl: lm.baseUrl, model: lm.model, apiKey: lm.apiKey ?? '' },
      builtin: { serverPath: bi.serverPath, modelPath: bi.modelPath },
      webLookup: c.webLookup === true,
      // Tavily Key(可选,2026-09-17):设置页填了才进档;saveAiConfig 里会洗(trim,空白当没填)
      tavilyKey: typeof c.tavilyKey === 'string' ? c.tavilyKey : undefined,
      // 个性化(第一百一十三锤)也得跟着进档:上一版在这一步被弄丢,设置完下次打开就打回原形
      personalization: sanitizePersonalization(c.personalization),
      // 手动上下文(留空 = 自动探测):上一版在这一步被弄丢,设置页填了也白填
      contextSize: typeof c.contextSize === 'number' && c.contextSize >= CONTEXT_SIZE_MIN ? c.contextSize : undefined
    })
    // 垃圾不白占:切走了内置模式,或换了模型/引擎设置,旧子进程就地解散,
    // 下次用到 AI 时按新配置重新拉起 —— 不然讲着旧模型的旧账
    if (previous.provider === 'builtin' && saved.provider !== 'builtin' && isBuiltinRunning()) {
      stopBuiltinServer()
      broadcastModelStatus(builtinIdleStatus(saved.builtin.modelPath))
    }
    if (saved.provider === 'builtin' && (builtinNeedsRestart(saved.builtin) || builtinContextDiffers(saved.contextSize ?? DEFAULT_CONTEXT_SIZE))) {
      stopBuiltinServer()
      broadcastModelStatus(builtinIdleStatus(saved.builtin.modelPath))
    }
    // 换了 provider 或模型,状态栏立刻照新配置报话,不等下一轮轮询
    void refreshModelStatus().catch(() => {})
    return saved
  })

  // ── 模型状态栏(第七十锤):界面随时来问当前状态;按「取消/卸下」就地解散引擎 ──
  ipcMain.handle(CH.modelStatusGet, async (): Promise<ModelStatus> => {
    const config = await loadAiConfig(app.getPath('userData'))
    if (config.provider === 'builtin') {
      // 引擎播报员有最新账就照账说;还没开播报过就拿配置兜底(上次用的模型 + 文件大小)
      return lastBuiltinStatus() ?? builtinIdleStatus(config.builtin.modelPath)
    }
    return probeLmStudioStatus(config)
  })
  ipcMain.handle(CH.modelEject, async (): Promise<{ ok: boolean; message?: string }> => {
    const config = await loadAiConfig(app.getPath('userData'))
    if (config.provider !== 'builtin') {
      return { ok: false, message: '外接模型的装卸归 LM Studio 管,这边只看状态' }
    }
    const wasRunning = isBuiltinRunning()
    stopBuiltinServer()
    broadcastModelStatus(builtinIdleStatus(config.builtin.modelPath))
    return { ok: true, message: wasRunning ? '模型卸下了,内存腾出来了;下次提问会重新热身' : '模型本来就没在跑' }
  })

  // 量尺(第七十三锤):选模型那一刻就拿块头比机器尺寸,带不动当场说,不让用户白等
  ipcMain.handle(CH.modelFitCheck, async (_event, modelPath: unknown): Promise<ModelFitVerdict> => {
    if (typeof modelPath !== 'string' || !modelPath.trim()) {
      return { level: 'empty', title: '', detail: '', sizeBytes: null }
    }
    const sizeBytes = await fs
      .stat(modelPath.trim())
      .then((s) => s.size)
      .catch(() => null)
    if (sizeBytes === null) {
      return { level: 'missing', title: '文件不存在', detail: '这个路径找不到文件:检查一下盘符和文件名', sizeBytes: null }
    }
    const spec = await queryMachineSpec()
    // 上下文缓存跟着配置走(第八十六锤):手动填了按手动的,没填按默认窗口(DEFAULT_CONTEXT_SIZE)
    const config = await loadAiConfig(app.getPath('userData'))
    const ctx = typeof config.contextSize === 'number' && config.contextSize >= CONTEXT_SIZE_MIN ? config.contextSize : DEFAULT_CONTEXT_SIZE
    return { ...judgeModelFit(sizeBytes, spec.ramBytes, spec.vramBytes, ctx), sizeBytes }
  })

  // 模型档案(上下文档位的账本):出厂上下文上限、层数头数、机器家底,一次端给设置页;
  // 档案翻不出来各条目就是 null,设置页自己退到粗估,不报错不拦人
  ipcMain.handle(CH.modelContextInfo, async (_event, modelPath: unknown): Promise<ModelContextInfo | null> => {
    if (typeof modelPath !== 'string' || !modelPath.trim()) return null
    const p = modelPath.trim()
    const sizeBytes = await fs
      .stat(p)
      .then((s) => s.size)
      .catch(() => null)
    const shape = await readModelShape(p)
    if (sizeBytes === null && shape === null) return null
    const spec = await queryMachineSpec()
    return { sizeBytes, nativeContext: shape?.contextLength ?? null, shape, ramBytes: spec.ramBytes, vramBytes: spec.vramBytes }
  })

  // 渲染层的报错小纸条:window.onerror / unhandledrejection 抓到的都送进后台账本 ——
  // 渲染层就算当场断气,主进程的账本还活着,下回排查有现场可看
  ipcMain.on(CH.rendererError, (_event, text: unknown) => {
    if (typeof text === 'string' && text.trim()) {
      console.log(`[renderer] 页面报错:${text.slice(0, 300)}`)
      addDevLog('system', `页面报错:${text.slice(0, 500)}`)
    }
  })

  // 「AI 设置」选模型文件:引擎已内置,用户只需要挑一个 GGUF 模型(弹窗认准来叫它的窗,同上)
  ipcMain.handle(CH.aiPickFile, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'GGUF 模型', extensions: ['gguf'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // 连接测试 + 列出本地模型:叫 LM Studio 报告它加载了哪些模型
  ipcMain.handle(CH.aiListModels, async (_event, baseUrl: unknown) => {
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') throw new Error('地址不能为空')
    const url = `${baseUrl.replace(/\/+$/, '')}/models`
    // 没应答就当没通(耐心档位在 shared/aiDefaults 的 PROBE_MODELS_MS):卡死时别让界面跟着无限转圈
    const res = await fetchWithTimeout(url, PROBE_MODELS_MS).catch(() => null)
    if (!res || !res.ok) {
      throw new Error(`连不上模型服务,检查 LM Studio 是否已启动(${baseUrl})`)
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return (data.data ?? []).map((m) => m.id)
  })

  // Tavily Key 体检(2026-09-17):设置里点「测一下」→ 拿框里那把 Key 查一次官方用量。
  // 打 /usage 不花搜索额度,Key 有效还能白带回本月剩余次数;只回结论,绝不回显 Key 本身
  // (报错信息里也不留);结果只在内存里给界面看,不落盘。
  ipcMain.handle(CH.aiTestTavily, (_event, key: unknown) => {
    const cleaned = sanitizeTavilyKey(key)
    if (!cleaned) throw new Error('Key 还是空的,先填一个再测。')
    return probeTavilyKey(cleaned, electronGetJson)
  })

  // git 改动总览:谁动了、动了多少行。不是 git 仓库时返回 isGitRepo=false,不炸
  ipcMain.handle(CH.gitChanges, (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    return collectGitChanges(rootPath)
  })

  // 人话讲解一个改动:diff 由主进程现场重取(不信任渲染进程传内容),再喂本地模型
  // 路径契约同 analyze-file:收 (rootPath, relPath),绝对路径只经 joinRoot 解析
  ipcMain.handle(CH.gitExplainChange, async (event, rootPath: unknown, relPath: unknown, requestId?: unknown) => {
    if (typeof rootPath !== 'string' || typeof relPath !== 'string') {
      throw new Error('参数不合法')
    }
    const changes = await collectGitChanges(rootPath)
    if (!changes.isGitRepo) {
      return { status: 'error', text: '这个文件夹不在 git 仓库里,没有改动可讲', model: '', durationMs: 0 }
    }
    const change = changes.changes.find((c) => c.relPath === relPath)
    if (!change) {
      return { status: 'error', text: '这个文件当前没有改动', model: '', durationMs: 0 }
    }
    const changeDiff = await getChangeDiff(rootPath, change)
    if (!changeDiff) {
      return { status: 'error', text: change.binary ? '二进制文件没法逐行对比,讲不了' : '这个文件太大,讲不了(先拆小再试)', model: '', durationMs: 0 }
    }
    if (!changeDiff.diff.trim()) {
      return { status: 'error', text: '这个文件没有可逐行对比的内容(可能只改了权限/编码)', model: '', durationMs: 0 }
    }
    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
    }
    const prompt = buildDiffPrompt({ relPath: change.relPath, kind: change.kind, diff: changeDiff.diff })
    return explainWithCancel(requestId, (signal) =>
      explainWithModel(resolved.target, prompt, withPersonalization(DIFF_SYSTEM_PROMPT, resolved.style), makeDeltaSender(event, requestId), signal, resolved.budgets.replyTokens)
    )
  })

  // AI 干活报告(第六十三锤):整轮改动翻成大白话审计 —— 干了什么/账对不对/要不要细看。
  // 账本由主进程现场重取(渲染进程递不进假货);改动集没变就走签名缓存,不重复烧模型。
  // 报告比单句讲解长(三段式),生成上限放宽到 900 tokens。
  ipcMain.handle(CH.gitReport, async (event, rootPath: unknown, requestId?: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    const changes = await collectGitChanges(rootPath)
    if (!changes.isGitRepo) {
      return { status: 'error', text: '这个文件夹不在 git 仓库里,没有账本可审', model: '', durationMs: 0 }
    }
    if (changes.changes.length === 0) {
      return { status: 'error', text: '当前没有任何改动 —— 账本干干净净,不用审。', model: '', durationMs: 0 }
    }
    const subjects = await collectRecentSubjects(rootPath)
    const signature = gitChangesSignature(changes, subjects)
    const cached = reportCache.get(signature)
    if (cached) return cached
    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
    }
    const makeReport = (rowLimit: number): Promise<AiExplainResult> =>
      explainWithCancel(requestId, (signal) =>
        explainWithMessages(
          resolved.target,
          [
            { role: 'system', content: withPersonalization(REPORT_SYSTEM_PROMPT, resolved.style) },
            {
              role: 'user',
              content: buildReportPrompt(
                {
                  branch: changes.branch,
                  changes: changes.changes,
                  stats: { additions: changes.stats.additions, deletions: changes.stats.deletions },
                  recentSubjects: subjects
                },
                rowLimit
              )
            }
          ],
          makeDeltaSender(event, requestId),
          signal,
          resolved.budgets.replyTokens,
          { onRestart: () => sendResetDelta(event, requestId) }
        )
      )
    // 先按标准清单问;小上下文装不下就把账本砍到 30 行再试最后一次(400 时模型一个字都没吐,流式不会重影)
    let result = await makeReport(REPORT_ROW_LIMIT)
    if (result.status === 'error' && isContextOverflow(result.text)) {
      result = await makeReport(30)
    }
    if (result.status === 'supported') {
      reportCache.set(signature, result)
      // 缓存封顶:只留最近 20 份,最旧的先出,别让 Map 悄悄长胖
      if (reportCache.size > 20) {
        const oldest = reportCache.keys().next().value
        if (oldest !== undefined) reportCache.delete(oldest)
      }
    }
    return result
  })

  // 功能定位(第六十七锤):「这个功能在哪」—— 渲染进程把扫描树递过来(不重扫不读文件),
  // 带路人照着地图指路;指回来的每个地址都对照真树点名,编造的一律拦下,全被拦就老实说指不了。
  ipcMain.handle(CH.locateFeature, async (_event, tree: unknown, question: unknown, requestId?: unknown) => {
    if (
      !tree ||
      typeof tree !== 'object' ||
      (tree as ScanDirNode).type !== 'directory' ||
      !Array.isArray((tree as ScanDirNode).children) ||
      typeof question !== 'string' ||
      question.trim() === ''
    ) {
      throw new Error('参数不合法')
    }
    const root = tree as ScanDirNode
    // 这一路故意不吃个性化(第一百一十三锤):带路人要吐严格 JSON,
    // 掺进语气/格式要求有把格式带歪的风险,而它本来也不该有「文风」
    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      return { status: 'error', hits: [], text: resolved.error, model: '', durationMs: 0 } satisfies FeatureLocateResult
    }
    const askTheGuide = (tokenBudget: number): Promise<AiExplainResult> =>
      explainWithCancel(requestId, (signal) =>
        explainWithMessages(
          resolved.target,
          [
            { role: 'system', content: LOCATE_SYSTEM_PROMPT },            { role: 'user', content: buildLocatePrompt({ digest: buildTreeDigest(root, LOCATE_NODE_BUDGET, tokenBudget), question: question.trim() }) }
          ],
          undefined,
          signal,
          resolved.budgets.replyTokens
        )
      )
    // 先按标准预算问;碰到小上下文装不下,把地图砍到三分之一再试最后一次
    let reply = await askTheGuide(resolved.budgets.mapTokens)
    if (reply.status === 'error' && isContextOverflow(reply.text)) {
      reply = await askTheGuide(Math.floor(resolved.budgets.mapTokens / 3))
    }
    if (reply.status !== 'supported') {
      const contextBlown = isContextOverflow(reply.text)
      return {
        status: 'error',
        hits: [],
        text: contextBlown
          ? '模型的上下文装不下这张地图(已经自动精简重试过还是不行)—— 把模型服务的上下文调大些,再回来问一次。'
          : reply.text,
        model: reply.model,
        durationMs: reply.durationMs
      } satisfies FeatureLocateResult
    }
    const hits = filterLocateHits(root, parseLocateReply(reply.text))
    if (hits.length === 0) {
      return {
        status: 'unsupported',
        hits: [],
        text: '带路人盯着地图,实在认不出这个功能住哪儿 —— 换个问法试试,或者先确认它真的在这个项目里。',
        model: reply.model,
        durationMs: reply.durationMs
      } satisfies FeatureLocateResult
    }
    return { status: 'supported', hits, text: '', model: reply.model, durationMs: reply.durationMs } satisfies FeatureLocateResult
  })

  // 人话解释一个文件:自动分流 —— AST 认识的语言摆结构(证据最硬);
  // 不认识的用名字 + 内容片段让模型猜(声明不确定);二进制直接本地人话,不劳烦模型
  // 路径契约同 analyze-file:收 (rootPath, relPath),绝对路径只经 joinRoot 解析
  ipcMain.handle(
    CH.aiExplainFile,
    async (event, rootPath: unknown, relPath: unknown, languageId: unknown, requestId?: unknown, question?: unknown, note?: unknown) => {
      if (typeof rootPath !== 'string' || typeof relPath !== 'string' || typeof languageId !== 'string') {
        throw new Error('参数不合法')
      }
      const ownerNote = typeof note === 'string' && note.trim() !== '' ? note.trim().slice(0, 100) : undefined
      const resolved = await resolveChatTargetOrError()
      if ('error' in resolved) {
        return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
      }
      const absPath = joinRoot(rootPath, relPath) // relPath 想越界会在这里被拦
      // stat 失败别吞成"不存在":系统核心文件(swapfile.sys 等)会给 EINVAL/EBUSY,得说真话
      const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
      if (stat instanceof Error) {
        throw new Error(accessDeniedMessage(stat, '文件', relPath), { cause: stat })
      }
      if (!stat.isFile()) {
        throw new Error(`这个路径不是一个文件:${relPath}`)
      }
      const name = relPath.split('/').pop() ?? relPath

      // 结构流:证据最硬 —— 函数/类/导入导出都摆给模型
      if (isAnalysisSupported(languageId) && stat.size <= SOURCE_PARSE_MAX_BYTES) {
        // 读内容也可能撞上独占/上锁(EBUSY/EPERM),同样走人话口径,不吐生面孔
        const code = await fs.readFile(absPath, 'utf8').catch((err: NodeJS.ErrnoException) => {
          throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
        })
        const structure = await analyzeSource(code, languageId)
        if (structure) {
          // 「详细」档喂源码(提示词体系重写第二批):锅够大才喂 —— 锅小 deep 已被降成 brief,
          // 那时节选照老规矩不垫;源码刚读过就在手边,截到 deepSourceChars(ctx) 字,读不到就静默不给
          const sourceExcerpt =
            resolved.teaching === 'deep' && resolved.ctx >= TEACHING_DEEP_MIN_CTX ? code.slice(0, deepSourceChars(resolved.ctx)) : null
          return respondWithEvidence(
            event,
            requestId,
            question,
            buildExplainPrompt({ relPath, name, languageName: structure.languageId, structure, graph: null, note: ownerNote, headerComment: extractHeaderComment(code), sourceExcerpt }),
            undefined,
            resolved
            // 结构流证据够硬(真代码结构),不掺联网查证
          )
        }
      }

      // 兜底流:猜猜官 —— 名字 + 内容片段,推测并声明不确定
      const preview =
        stat.size === 0
          ? ''
          : await readTextPreview(absPath).catch((err: NodeJS.ErrnoException) => {
              throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
            })
      if (preview === null) {
        // 二进制读不出文字:读文件头认类型当真证据,照样让模型讲,只是明说"按类型推测"
        const header = stat.size === 0 ? Buffer.alloc(0) : await readHeader(absPath)
        const kind = sniffBinaryKind(header, name)
        const typeInfo = kind
          ? kind.dims
            ? `${kind.type},尺寸 ${kind.dims}`
            : kind.type
          : '认不出具体格式(文件头不像任何已知类型)'
        return respondWithEvidence(
          event,
          requestId,
          question,
          buildBinaryPrompt({ relPath, name, typeInfo, sizeText: formatSize(stat.size) }),
          buildExplainSystem(effectiveTeaching(resolved).teaching, 'guess'),
          resolved,
          name
        )
      }
      const languageName = BY_EXT.get(extOf(name))?.name ?? ''
      return respondWithEvidence(
        event,
        requestId,
        question,
        buildGuessPrompt({ relPath, name, absPath, languageName, preview, note: ownerNote }),
        buildExplainSystem(effectiveTeaching(resolved).teaching, 'guess'),
        resolved,
        name
      )
    }
  )

  // 人话解释一个文件夹:目录清单就是证据;空文件夹直接本地人话,不劳烦模型
  // relPath 传 '' 表示解释项目根目录本身;自由聊天有专门的 atlas:ai-chat 通道
  ipcMain.handle(
    CH.aiExplainFolder,
    async (event, rootPath: unknown, relPath: unknown, requestId?: unknown, question?: unknown) => {
    if (typeof rootPath !== 'string' || typeof relPath !== 'string') {
      throw new Error('参数不合法')
    }
    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
    }
    const absPath = joinRoot(rootPath, relPath)
    const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
    if (stat instanceof Error) {
      throw new Error(accessDeniedMessage(stat, '文件夹', relPath || '(根目录)'))
    }
    if (!stat.isDirectory()) {
      throw new Error(`这不是一个文件夹:${relPath || '(根目录)'}`)
    }
    let dirents
    try {
      dirents = await fs.readdir(absPath, { withFileTypes: true })
    } catch (err) {
      // stat 能过但 readdir 被拒:也是"锁着",不是空文件夹
      throw new Error(accessDeniedMessage(err as NodeJS.ErrnoException, '文件夹', relPath || '(根目录)'), { cause: err })
    }
    if (dirents.length === 0) {
      return { status: 'unsupported', text: '这是个空文件夹,啥也没装,就不用劳烦模型了', model: '', durationMs: 0 }
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name))
    const subdirs: string[] = []
    const files: string[] = []
    const languages = new Map<string, number>()
    // 通用后缀分布:什么文件都数(.exe/.dll/.log 是认出系统文件夹的关键证据,编程语言认不出的也算)
    const extCounts = new Map<string, number>()
    for (const item of dirents) {
      if (item.isDirectory()) {
        subdirs.push(item.name)
        continue
      }
      if (!item.isFile()) continue // 符号链接等不靠谱的,跳过
      files.push(item.name)
      const langName = BY_EXT.get(extOf(item.name))?.name ?? '没认出的文件'
      languages.set(langName, (languages.get(langName) ?? 0) + 1)
      const dot = item.name.lastIndexOf('.')
      const ext = dot > 0 ? item.name.slice(dot).toLowerCase() : '(无后缀)'
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)
    }
    const folderName = basename(absPath) || basename(rootPath)
    return respondWithEvidence(
      event,
      requestId,
      question,
      buildFolderPrompt({
        relPath,
        name: folderName,
        absPath,
        subdirs,
        files,
        languages: Object.fromEntries(languages),
        extCounts: Object.fromEntries(extCounts)
      }),
      buildExplainSystem(effectiveTeaching(resolved).teaching, 'folder'),
      resolved,
      folderName
    )
  })

  // 自由对话:独立通道、独立人设(Atlas 小探针)。当前选中对象的资料以「附件」身份
  // 垫在最前面,仅供参考,不进历史 —— 换对象不带旧资料,旧对话也不污染新对象。
  // 用户点名要联网(联网/搜搜/查查…)且开关开着,程序先按名字真查一份资料再开答;
  // 查询的每一步状态(查着了/没查到/没开开关)都以程序账本为准回传,模型说了不算。
  ipcMain.handle(CH.aiChat, async (event, req: unknown): Promise<AiChatResult> => {
    const startedAt = Date.now()
    const notRequested: WebLookupMeta = { requested: false, enabled: false, attempted: false, state: 'not_requested', sources: [] }
    const body = (typeof req === 'object' && req !== null ? req : {}) as Record<string, unknown>
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    // 带了引用就允许「只发代码不发问题」,这时给一句通用问法当题目 ——
    // 光甩几段代码过去,模型不知道该讲哪一面。先用保底账探一下有没有引用,
    // 真正按这轮的锅裁额度,要等模型服务和思考开关都落定之后(见下方 codeRefs)
    const hasRefs = sanitizeCodeRefs(body.codeRefs).length > 0
    if (!question && !hasRefs) {
      return { status: 'error', text: '先输入一句话再发送', model: '', durationMs: 0, webLookup: notRequested }
    }
    const questionText = question || '讲讲选中的这段代码'
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    const history = sanitizeHistory(body.history)
    const attachment = sanitizeAttachment(body.context)
    // 思考模式(第一百一十五锤):界面开关说了算;开着就允许模型先想一遍,思考过程展示给用户
    const thinking = body.thinking === true
    const requested = hasSearchIntent(questionText)

    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      // 模型服务都没通,查询自然也没发生:如实记成 failed,不让账本装无事发生
      const meta: WebLookupMeta = requested
        ? { requested: true, enabled: false, attempted: false, state: 'failed', sources: [] }
        : notRequested
      return { status: 'error', text: resolved.error, model: '', durationMs: Date.now() - startedAt, webLookup: meta }
    }

    // 联网查询先行:状态边查边播报(searching → completed/failed/empty),不等模型开金口
    const enabled = resolved.webLookup
    let outcome: { kind: 'skipped' } | { kind: 'attempted'; material: string; sources: string[] } | { kind: 'error' } = { kind: 'skipped' }
    let webMaterial: { query: string; material: string } | null = null
    if (requested && enabled) {
      const query = pickWebLookupQuery(questionText, attachment)
      sendChatLookup(event, requestId, 'searching', [])
      try {
        // 源队列在纯函数层:Tavily 有 Key 打头,没 Key 走免费链(DDG → 维基)
        const found = await webLookupDetailed(query, { fetchText: electronFetchText, postJson: electronPostJson, tavilyKey: resolved.tavilyKey })
        outcome = { kind: 'attempted', material: found.material, sources: found.sources }
        if (found.material) webMaterial = { query, material: found.material }
      } catch {
        outcome = { kind: 'error' }
      }
      const finalState = outcome.kind === 'attempted' ? (outcome.material === '' ? 'empty' : 'completed') : 'failed'
      sendChatLookup(event, requestId, finalState, outcome.kind === 'attempted' ? outcome.sources : [])
    }

    const meta = resolveWebLookupMeta(requested, enabled, outcome)
    // 闲聊底座 = 内核 + 聊天切片;翻文件开着时无工具切片不挂(翻文件切片由 agent 路自己追加)
    const systemPrompt = withPersonalization(buildChatSystem({ agent: body.agent === true }), resolved.style)
    // 开思考就多给一笔推理额度:思考段也算在 max_tokens 里,不加额度思考就把答案吃光(第一百一十五锤)
    const cap = thinking ? resolved.budgets.replyTokens + THINKING_EXTRA_TOKENS : resolved.budgets.replyTokens
    // 引用的动态账(第一百二十六锤):锅里先给人设+附件+历史+问题留座,回答(含思考预留)也占座,
    // 剩下的折成字符才是引用能带的量;穷保底、富封顶,额度跟着用户设的上下文走
    const otherTokens =
      estimateTokens(systemPrompt) +
      estimateTokens(attachment ? buildAttachmentText(attachment) : '') +
      estimateTokens(history.map((h) => h.content).join('\n')) +
      estimateTokens(questionText) +
      estimateTokens(webMaterial ? webMaterial.material : '')
    const refsBudget = codeRefsBudget({ contextTokens: resolved.ctx, otherTokens, replyTokens: cap })
    const codeRefs = sanitizeCodeRefs(body.codeRefs, refsBudget)
    const questionText2 = question || (codeRefs.length > 0 ? '讲讲选中的这段代码' : questionText)
    // 手动压缩的早前对话摘要(第一百四十二锤):/compact 之后每次请求都带,垫在历史前面当背景记忆
    const summary = sanitizeCompactSummary(body.summary)
    const messages = buildFreeChatMessages(systemPrompt, attachment, history, questionText2, webMaterial, codeRefs, resolved.teaching, summary)
    // 翻文件模式(agent,第一百二十八锤):开关开着就走工具循环 —— 模型自己喊看哪,
    // 主进程沙盒里翻给它看;rootPath 是沙盒的墙,没带或不对就老实说翻不了
    if (body.agent === true) {
      const agentRoot = typeof body.rootPath === 'string' && body.rootPath.trim() !== '' ? body.rootPath : ''
      if (agentRoot === '') {
        return {
          status: 'error',
          text: '翻文件模式得先打开一个项目才有得翻:关掉「翻文件」开关,或先在左边打开项目再问',
          model: '',
          durationMs: Date.now() - startedAt,
          webLookup: meta
        }
      }
      const aborter = new AbortController()
      if (requestId !== '') explainAborters.set(requestId, aborter)
      try {
        return await runAgentChat({
          event,
          requestId,
          target: resolved.target,
          systemPrompt,
          baseMessages: messages,
          rootPath: agentRoot,
          ctx: resolved.ctx,
          replyCap: cap,
          allowThinking: thinking,
          signal: aborter.signal,
          startedAt,
          webLookup: meta,
          webSearchEnabled: resolved.webLookup === true,
          tavilyKey: resolved.tavilyKey
        })
      } finally {
        if (requestId !== '') explainAborters.delete(requestId)
        if (explainAborters.size === 0) announceActivityIdle()
      }
    }
    const aborter = new AbortController()
    if (requestId !== '') explainAborters.set(requestId, aborter)
    try {
      const streamOpts = {
        allowThinking: thinking,
        onRestart: () => sendResetDelta(event, requestId)
      }
      let res = await explainWithMessages(resolved.target, messages, makeDeltaSender(event, requestId), aborter.signal, cap, streamOpts)
      // 上下文爆了的自动救援(自动压缩那案):服务拒收时模型一个字没吐,把旧聊天史砍到最近 2 条重试一轮;
      // 只兜一次,再爆就照实给指路话,不跟它无限耗
      if (res.status === 'error' && isContextOverflow(res.text)) {
        sendResetDelta(event, requestId)
        const slimMessages = buildFreeChatMessages(systemPrompt, attachment, history.slice(-2), questionText2, webMaterial, codeRefs, resolved.teaching, summary)
        res = await explainWithMessages(resolved.target, slimMessages, makeDeltaSender(event, requestId), aborter.signal, cap, streamOpts)
        if (res.status === 'error' && isContextOverflow(res.text)) {
          res = {
            ...res,
            text: '这段对话把模型的上下文撑爆了(已经自动清掉旧聊天重试过还是不行):点「新对话」轻装上阵,或者把模型的上下文调大再来。'
          }
        }
      }
      // 用户主动掐掉(经 atlas:ai-cancel):如实记 cancelled,不算模型出错
      const status = aborter.signal.aborted ? 'cancelled' : res.status
      return { ...res, status, webLookup: meta }
    } finally {
      if (requestId !== '') explainAborters.delete(requestId)
      if (explainAborters.size === 0) announceActivityIdle()
    }
  })

  // /compact 手动压缩(第一百四十二锤):把目前为止的对话提炼成一份要点摘要,
  // 渲染进程拦下 /compact 后走这条专属通道。流式增量照走 atlas:ai-delta 按 requestId 对号,
  // 「停一停」也照常能掐(登记进 explainAborters);压缩是程序差事,不接思考开关。
  ipcMain.handle(CH.aiCompact, async (event, req: unknown): Promise<AiExplainResult> => {
    const startedAt = Date.now()
    const body = (typeof req === 'object' && req !== null ? req : {}) as Record<string, unknown>
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    const history = sanitizeCompactHistory(body.history)
    if (history.length === 0) {
      return { status: 'error', text: '没有可压缩的对话:先聊几句再来', model: '', durationMs: Date.now() - startedAt }
    }
    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      return { status: 'error', text: resolved.error, model: '', durationMs: Date.now() - startedAt }
    }
    const aborter = new AbortController()
    if (requestId !== '') explainAborters.set(requestId, aborter)
    try {
      return await explainWithMessages(resolved.target, buildCompactMessages(history), makeDeltaSender(event, requestId), aborter.signal, resolved.budgets.replyTokens, {
        allowThinking: false,
        onRestart: () => sendResetDelta(event, requestId)
      })
    } finally {
      if (requestId !== '') explainAborters.delete(requestId)
      if (explainAborters.size === 0) announceActivityIdle()
    }
  })

  // 试一句(第一百一十三锤):设置页改完说话方式,拿草稿当场念一段听效果。
  // 关键在「草稿」二字 —— 走的是传进来的那份个性化,不是存档里的那份,
  // 所以还没点「应用更改」也能试,试完不满意直接退回,不用先存再改。
  ipcMain.handle(CH.aiStyleSample, async (event, personalization: unknown, requestId?: unknown): Promise<AiExplainResult> => {
    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
    }
    const style = buildPersonalizationPrompt(sanitizePersonalization(personalization))
    const system = withPersonalization(STYLE_SAMPLE_SYSTEM, style)
    return explainWithCancel(requestId, (signal) =>
      explainWithModel(resolved.target, STYLE_SAMPLE_QUESTION, system, makeDeltaSender(event, requestId), signal, resolved.budgets.replyTokens)
    )
  })

  // 掐掉还在生成的讲解:渲染进程换了讲解目标/关掉卡片时喊一声,模型立刻空出来讲下一个
  ipcMain.handle(CH.aiCancel, (_event, requestId: unknown) => {
    if (typeof requestId !== 'string' || requestId === '') return
    explainAborters.get(requestId)?.abort()
    explainAborters.delete(requestId)
  })

  // 联网查证(可选举手):讲解认不出软件/品牌时,拿「名字」去公开源查免费资料。
  // 只许传名字,不许传本地路径 —— 隐私边界写在调用方;5 秒超时,查不到返回空串,上层自己回退。
  // Key 跟着配置走:用户填了 Tavily,这条通道也吃同一把 Key(Tavily → DDG → 维基)
  ipcMain.handle(CH.webLookup, async (_event, query: unknown) => {
    if (typeof query !== 'string' || query.trim() === '') return ''
    const { tavilyKey } = await loadAiConfig(app.getPath('userData'))
    return webLookup(query, { fetchText: electronFetchText, postJson: electronPostJson, tavilyKey })
  })

  // 右键文件链接复制完整路径:只往剪贴板写一个字符串,不开文件不执行任何东西 ——
  // 找到真文件后「开不开、怎么开」完全留给用户自己决定。路径照契约走 joinRoot 解析
  ipcMain.handle(CH.copyFilePath, (_event, rootPath: unknown, relPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath === '' || typeof relPath !== 'string' || relPath === '') {
      return { ok: false as const, message: '路径信息不完整,复制不了' }
    }
    try {
      const abs = joinRoot(rootPath, relPath)
      clipboard.writeText(abs)
      return { ok: true as const, path: abs }
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : '复制失败' }
    }
  })

  // 右键文件链接「在文件资源管理器中显示」:把资源管理器拉到文件面前、选中高亮,
  // 照样不开文件不执行任何东西 —— 到家门口为止,开不开门用户自己定
  ipcMain.handle(CH.revealFilePath, (_event, rootPath: unknown, relPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath === '' || typeof relPath !== 'string' || relPath === '') {
      return { ok: false as const, message: '路径信息不完整,打不开' }
    }
    try {
      const abs = joinRoot(rootPath, relPath)
      if (!existsSync(abs)) return { ok: false as const, message: '这个文件好像已经不在了,可能被移动或删除过' }
      shell.showItemInFolder(abs)
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : '打不开文件夹' }
    }
  })
}

/** 清掉 7 天前的崩溃转储(.dmp):单份好几 MB,崩几次就攒一坨,应用不该自己攒垃圾 */
async function cleanupOldCrashDumps(userDataDir: string): Promise<void> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const dirs = [join(userDataDir, 'Crashpad', 'reports'), join(userDataDir, 'Crashpad', 'pending')]
  for (const dir of dirs) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue // 目录不存在 = 没崩过,好事
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.dmp')) continue
      const fullPath = join(dir, entry.name)
      const stat = await fs.stat(fullPath).catch(() => null)
      if (stat && stat.mtimeMs < cutoff) {
        await fs.rm(fullPath, { force: true }).catch(() => {})
      }
    }
  }
}

// 根治「画面凭空消失」(2026-09-13 小葵三次报案,第三次坐实:进程和页面全活着,
// 没有任何事件可抓,聊多了必犯)—— 这台 Win10 的透明无边框窗,显卡合成链一打嗝就整窗
// 透明蒸发,而且悄无声息,救生圈的监听根本收不到通知。那就釜底抽薪:不让 GPU 参与合成,
// 软件渲染(Skia)的每一帧都不经过显卡驱动,透明窗从此跟驱动打嗝绝缘。
// 咱家是文本/列表界面,没有视频大图要喂,软件合成的代价付得起。必须在 app 就绪前调用。
app.disableHardwareAcceleration()
// 第四案(软件渲染版照样隐身)补刀:凶手不在显卡,在 Windows 合成器那一层。
// 两道开关都冲着「无声断供」去:
// ① Chromium 的原生窗口遮挡计算在 Windows 上有老毛病,会把没被遮住的窗误判成
//    「被遮住了」从而停画 —— 这是社区公认的窗口凭空消失惯犯,直接关掉这个 feature;
// ② 见 createWindow 里的 5 秒一次强制重画(让 DWM 随时都能接上新帧)。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
// 退出时把全局快捷键一并还回去,不留幽灵热键占着系统;托盘图标一并摘掉,不留僵尸托盘
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (tray) {
    tray.destroy()
    tray = null
  }
})

function startApp(): void {
  createWindow()
  registerIpc()
  createTray()
  // 桌宠通道(走出面板锤):窗改 lazy —— 对话住进桌宠时 ensureMascot 现建,
  // 平时桌面干干净净;点它 = 对话气泡开/关;拖拽落定那刻气泡按落点归位一次
  // (跟随降频:不每帧都追,透明窗高频挪窗是雷区,一次挪窗攒不出膨胀)
  registerMascotIpc({
    onActivate: (anchor) => toggleBubble(anchor),
    onDragEnd: (anchor) => followBubble(anchor),
    onDock: () => dockFreechat(),
    onShowMain: () => showMainWindow(),
    // 主面板的显示/隐藏/最小化/恢复都由控制器记账:在不在屏上问它,收回托盘也让它动手
    isMainVisible: () => mainPanelController?.isShown() ?? false,
    onHideMain: () => mainPanelController?.hide()
  })
  // 页签拖出主窗 / 页签右键「放到桌面」= 放出小探针(只认主窗渲染层发来的;
  // force=true 是右键菜单点的,跳过窗外判定,桌宠落记忆位)
  ipcMain.on(CH.freechatDetach, (event, force: unknown) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindowRef) return
    detachFreechat(force === true)
  })
  // 气泡通道(桌宠气泡):共享对话要够得着主窗;
  // 「回主面板」走 dock 收回链路(气泡+主窗占位卡同路)
  registerBubbleIpc({
    getMainWindow: () => mainWindowRef,
    dock: () => dockFreechat(),
    stateDir: app.getPath('userData')
  })

  // 后台日志广播员上岗(第八十七锤):每记一笔就推给所有窗口(日志窗口常驻收听)
  setDevLogListener((entry) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(CH.devLog, entry)
    }
  })
  addDevLog('system', 'CodeAtlas 启动')

  // 内置引擎的状态播报员上岗:引擎一动(热身/进度/就绪/出岔子/被卸下)就广播给状态栏
  setBuiltinStatusAnnouncer(broadcastModelStatus)
  // 热身耗时小账本安家 userData:模型上次热身多久,下次估价进度就有据可依
  setBuiltinWarmupDir(app.getPath('userData'))
  // 机器家底提前问一遍(显存走 nvidia-smi):引擎万一启动就死,验尸话张口就来,不现场等
  void queryMachineSpec().catch(() => {})

  // 开场两件家务:上次异常退出留下的内置模型孤儿就地收尸(不占内存不堵端口);
  // 旧的崩溃转储过期的清掉。都是后台安静干,失败也不打扰启动
  void reapOrphanServer().catch(() => {})
  void cleanupOldCrashDumps(app.getPath('userData')).catch(() => {})

  // macOS:点 Dock 图标时,没有窗口就重新建一个
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

// ── 单实例锁(桌宠托管第一锤;当年双实例 GPU 缓存大战的老伤疤,别再揭一次)──
// 抢不到锁 = 已经有一个 CodeAtlas 在跑:本实例一个窗都不建,悄悄退场。
// 已在跑的实例通过 second-instance 收到敲门:把主窗带焦点唤回前台。
app.on('before-quit', () => {
  quitting = true
})

app.on('second-instance', () => {
  showMainWindow()
})
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.whenReady().then(startApp)
}

app.on('will-quit', () => {
  stopBuiltinServer() // 内置模型是子进程,退出时带走,不留孤儿进程占着显存
})

app.on('window-all-closed', () => {
  // Windows / Linux:所有窗口都没了才退出。收起模式(桌宠托管第一锤)下关窗只是
  // 藏进托盘、窗口不销毁,这个事件不触发 —— 真退出走托盘「退出」,走到这儿时
  // quit 已在进行,再喊一声无害
  if (process.platform !== 'darwin') app.quit()
})
