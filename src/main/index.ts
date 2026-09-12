import { app, dialog, ipcMain, net, screen, shell, BrowserWindow, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { basename, join } from 'node:path'
import { promises as fs } from 'node:fs'
import { scanDirectory, IGNORED_NAMES } from '../scanner/index.ts'
import {
  AGENT_ADDENDUM,
  AGENT_FILE_MAX_BYTES,
  AGENT_LIST_MAX_ENTRIES,
  AGENT_MAX_DEPTH,
  AGENT_MAX_ROUNDS,
  ROUND_CAP_NUDGE,
  REPEAT_NUDGE,
  agentReadChars,
  agentRound,
  agentStepText,
  extractToolCalls,
  mergeUsage,
  sanitizeAgentRelPath,
  toolCallKey,
  type AgentChatMessage,
  type AgentStreamEvent
} from '../ai/agent.ts'
import { THINKING_EXTRA_TOKENS } from '../shared/aiDefaults.ts'
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
  FREE_CHAT_SYSTEM_PROMPT,
  DIFF_SYSTEM_PROMPT,
  FOLDER_SYSTEM_PROMPT,
  GUESS_SYSTEM_PROMPT,
  REPORT_SYSTEM_PROMPT,
  LOCATE_SYSTEM_PROMPT,
  LOCATE_NODE_BUDGET,
  SYSTEM_PROMPT,
  STYLE_SAMPLE_SYSTEM,
  STYLE_SAMPLE_QUESTION,
  isBinaryFile
} from '../ai/index.ts'
import { webLookupDetailed, webLookup, WEB_LOOKUP_TIMEOUT_MS, type LookupTransport } from '../ai/weblookup.ts'
import { loadAiConfig, saveAiConfig, resolveAiTarget, type BuiltinRuntime } from '../ai/config.ts'
import { builtinNeedsRestart, builtinIdleStatus, ensureBuiltinServer, isBuiltinRunning, judgeModelFit, lastBuiltinStatus, queryMachineSpec, reapOrphanServer, setBuiltinStatusAnnouncer, setBuiltinWarmupDir, stopBuiltinServer } from '../ai/builtin.ts'
import { BY_EXT } from '../parser/languages.ts'
import { joinRoot } from '../shared/paths.ts'
import { clipPreview, looksBinary, PREVIEW_MAX_BYTES } from '../shared/preview.ts'
import { buildPersonalizationPrompt, sanitizePersonalization, withPersonalization } from '../shared/personalization.ts'
import { formatStreamStats } from '../shared/aiText.ts'
import { addDevLog, clearDevLogs, devLogSnapshot, setDevLogListener } from '../shared/devlog.ts'
import { placeWindowBox, readWindowState, writeWindowState, type WindowBox } from './window-state.ts'
import { queryDriveKinds } from './drive-meta.ts'
import type { AiChatLookupPayload, AiChatResult, AiConfig, AiDeltaPayload, AiExplainResult, AiProviderKind, AiStreamStats, AiUsage, ChatTarget, DriveInfo, FeatureLocateResult, FilePreviewResult, ModelFitVerdict, ModelStatus, ScanDirNode, WebLookupMeta } from '../shared/types.ts'

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
  return `${prompt}\n\n用户的问题:${q}\n请直接围绕这个问题回答(结合上面给出的文件信息),不要泛泛做全面介绍。`
}

/** 还在生成中的讲解请求,按 requestId 登记:渲染进程换了讲解目标,旧的就地掐掉,不让过气的生成占着模型排队 */
const explainAborters = new Map<string, AbortController>()

/** 干活报告的签名缓存:同一份改动集(账本+最近提交主题一样)不重复烧模型,最多留 20 份 */
const reportCache = new Map<string, AiExplainResult>()

/**
 * 讲解通道的共用出口:证据优先,单问单答。question 是用户点名的问题(预设/输入框),
 * 追加到证据后面让模型围绕问题作答;lookupName(只传名字,绝不传路径)给着且开关开着时,
 * 首次讲解走联网增强:先正常讲,答案带「需要联网确认」信号才查公开资料并修正。
 * (自由聊天不在这里 —— 它有自己的 atlas:ai-chat 通道和人设,不往这条路上堆条件。)
 */
async function respondWithEvidence(
  event: IpcMainInvokeEvent,
  requestId: unknown,
  question: unknown,
  evidence: string,
  system: string | undefined,
  resolved: { target: ChatTarget; webLookup: boolean; budgets: { replyTokens: number }; style: string },
  lookupName?: string
): Promise<AiExplainResult> {
  const onDelta = makeDeltaSender(event, requestId)
  const hasQuestion = typeof question === 'string' && question.trim() !== ''
  // 人设口径保持原样:给了就用给的,没给就是文件讲解官那一套;个性化一律叠在最上面
  const persona = withPersonalization(system ?? SYSTEM_PROMPT, resolved.style)
  if (resolved.webLookup && lookupName && !hasQuestion) {
    // 联网那条老规矩没变:没人设时它本来就用导游那一套(和普通流不同,别一起改)
    return explainWithWebLookup(
      requestId,
      evidence,
      withPersonalization(system ?? FOLDER_SYSTEM_PROMPT, resolved.style),
      lookupName,
      resolved.target,
      onDelta,
      resolved.budgets.replyTokens
    )
  }
  return explainWithCancel(requestId, (signal) =>
    explainWithModel(resolved.target, withQuestion(evidence, hasQuestion ? question : undefined), persona, onDelta, signal, resolved.budgets.replyTokens)
  )
}

/**
 * 联网增强的讲解:先安静地讲一遍(答案里可能带信号词),带信号就查公开资料、
 * 流式输出修正版;没信号/查不到/修正失败,都老老实实回落到本地推测的版本。
 */
async function explainWithWebLookup(
  requestId: unknown,
  evidence: string,
  system: string,
  lookupName: string,
  target: ChatTarget,
  onDelta: ((text: string) => void) | undefined,
  replyTokens: number
): Promise<AiExplainResult> {
  const first = await explainWithCancel(requestId, (signal) =>
    explainWithModel(target, evidence + WEB_SIGNAL_INSTRUCTION, system, undefined, signal, replyTokens)
  )
  if (first.status !== 'supported' || !hasWebLookupSignal(first.text)) return first
  const material = await webLookup(lookupName, electronFetchText).catch(() => '')
  if (!material) {
    // 查不到(没网/超时/太冷门):剥掉信号词,加上一句人话交代,回退本地推测
    const fallback = first.text.replace(/「?需要联网确认」?/g, '').trimEnd()
    return { ...first, text: `${fallback}\n\n(联网没查到这个,上面是本地推测。)` }
  }
  const refined = await explainWithCancel(requestId, (signal) =>
    explainWithMessages(target, buildRefineMessages(system, evidence, first.text, material), onDelta, signal, replyTokens)
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
  { target: ChatTarget; webLookup: boolean; budgets: { mapTokens: number; replyTokens: number }; style: string; ctx: number } | { error: string }
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
  const ctx = config.contextSize ?? (await probeContextSize(resolved.target, config.provider)) ?? DEFAULT_CONTEXT_SIZE
  // 个性化段在这儿一次拼好,跟着 resolved 走遍所有调用点:全默认时是空串,人设一字不加
  const style = buildPersonalizationPrompt(sanitizePersonalization(config.personalization))
  return { target: resolved.target, webLookup: config.webLookup === true, budgets: budgetsForContext(ctx), style, ctx }
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
    event.sender.send('atlas:ai-delta', payload)
    // 引擎肯报账,状态栏的「忙」就跟着报数(第八十四锤)
    if (stats) announceActivityBusy(lastActivityProvider, stats)
  }
}

/** 自由对话的联网状态播报:查着没查着都是程序说了算,按 requestId 对号推给界面挂标签 */
function sendChatLookup(event: IpcMainInvokeEvent, requestId: unknown, state: AiChatLookupPayload['state'], sources: string[]): void {
  if (typeof requestId !== 'string' || requestId === '') return
  if (!event.sender.isDestroyed()) {
    event.sender.send('atlas:ai-chat-lookup', { id: requestId, state, sources } satisfies AiChatLookupPayload)
  }
}

// ── 第七十锤:模型状态栏的后厨 ──
// 内置引擎的状态由 builtin.ts 播报员推过来;外接 LM Studio 没法订阅,只能低频去问。
// 两路都汇到 broadcastModelStatus,渲染层的常驻底栏只认这一条频道。

function broadcastModelStatus(status: ModelStatus): void {
  // 第八十八锤:必须挨个窗都发 —— Developer 日志窗进了队,「[0]」不一定是主窗;
  // 广播喂给没人听的日志窗,主窗底栏就冻死在「还没叫醒」
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('atlas:model-status', status)
  }
}

/** 问一轮 LM Studio:模型加载了没/热身到多少;服务没开就老实说没连上,不装没事 */
async function probeLmStudioStatus(config: AiConfig): Promise<ModelStatus> {
  const model = config.lmstudio.model.trim()
  const root = config.lmstudio.baseUrl.trim().replace(/\/v1\/?$/, '') || 'http://127.0.0.1:1234'
  const base = { provider: 'lmstudio' as const, modelName: model, sizeBytes: null, progress: null }
  if (!model) return { ...base, state: 'idle', message: '还没填模型名:去「AI 设置」连一下 LM Studio' }
  try {
    const res = await fetch(`${root}/api/v0/models`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const parsed = parseLmStudioModelState(await res.json().catch(() => null), model)
      return { ...base, state: parsed.state, progress: parsed.progress }
    }
    // 老版本 LM Studio 没有 v0 接口:OpenAI 兼容口能列出模型就当就绪
    const legacy = await fetch(`${root}/v1/models`, { signal: AbortSignal.timeout(3000) })
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
    broadcastModelStatus({ ...base, state: 'ready', progress: null, estimated: undefined, message: undefined })
  }
}

// ── Developer 日志窗口(第八十七锤):模型后台原话亮出来看 ──
// 独立小窗(frameless,和主窗一个壳),渲染层用 ?view=devlogs 分支画日志页。
// 引擎的每一行原话、每笔请求报账,广播员推给所有窗口,这窗常驻收听。

let devLogWindow: BrowserWindow | null = null

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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  devLogWindow = win
  win.on('closed', () => {
    if (devLogWindow === win) devLogWindow = null
  })
  // 露窗三保险,和主窗同一条链:ready-to-show 快路 + 渲染层双 rAF 首帧信号
  // (按 sender 认窗,不抢主窗的信号)+ 3 秒看门狗,绝不永久隐身
  let shown = false
  const showOnce = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
  }
  win.once('ready-to-show', showOnce)
  const onFirstFrame = (_event: Electron.IpcMainEvent): void => {
    if (_event.sender === win.webContents) {
      showOnce()
      ipcMain.removeListener('atlas:first-frame', onFirstFrame)
    }
  }
  ipcMain.on('atlas:first-frame', onFirstFrame)
  setTimeout(showOnce, 3000)
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('view', 'devlogs')
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'devlogs' } })
  }
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
    minWidth: 960,
    minHeight: 640,
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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 首帧探测靠渲染层 rAF 发信号;窗口还藏着时后台节流会把 rAF 憋死,必须关掉
      backgroundThrottling: false
    }
  })

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
  mainWindow.on('close', () => {
    if (stateSaveTimer) clearTimeout(stateSaveTimer)
    persistWindowState()
  })
  // 上回关窗时是最大化:先把存档的正常大小落好,再进最大化,圆角描边那条链照常接手
  if (savedWindowState?.maximized) mainWindow.maximize()

  // ── 露窗链:多路信号抢跑 + 无条件看门狗,窗口绝不永久隐身 ──
  // 本机实测(模块四验收):ready-to-show 只在 GPU 缓存健康时才来 —— 缓存被另一个
  // 实例锁住(Gpu Cache Creation failed)或被污染时就永远装死;当年「窗隐身」就是
  // 两实例缓存大战 + show 眼巴巴等 ready-to-show 叠出来的。所以下面每一路都只当快路,
  // 谁都不许当唯一依靠,3 秒看门狗才是保底。
  let shown = false
  let shownVia = 'never'
  const showOnce = (why: string): void => {
    if (shown || mainWindow.isDestroyed()) return
    shown = true
    shownVia = why
    mainWindow.show()
    console.log(`[window] 露窗方式:${why}`)
  }
  // 1) 常见快路:GPU 栈干净时它先到
  mainWindow.once('ready-to-show', () => showOnce('ready-to-show'))
  // 2) 渲染层双 rAF 信号(合成器肯给隐藏窗出帧的机器上生效,多数机器到不了这)
  ipcMain.removeAllListeners('atlas:first-frame')
  ipcMain.on('atlas:first-frame', () => showOnce('first-frame'))
  // 3) 加载完主动催一帧:万一合成器还醒着,别让它干等
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.invalidate()
    // 顺手把模型状态问一轮:状态栏一开屏就有真话可说,不用干等轮询
    void refreshModelStatus().catch(() => {})
  })
  // 外接 LM Studio 没法订阅它的内部状态:低频去问(10 秒一轮,本地请求很轻);
  // 内置引擎靠播报员事件推,不占这个轮询
  const modelStatusTimer = setInterval(() => {
    void refreshModelStatus().catch(() => {})
  }, 10_000)
  mainWindow.on('closed', () => {
    clearInterval(modelStatusTimer)
    // 主窗走了,Developer 日志窗没有独活的意义:一起带走,应用照常退出
    if (devLogWindow && !devLogWindow.isDestroyed()) devLogWindow.close()
  })
  // 4) 看门狗(唯一无条件的兜底):3 秒硬拉露窗 —— 宁可早闪一下,不可隐身躲猫猫。
  //    隐藏的透明窗此刻多半还没内容,用户看到「窗口浮现」的实际时刻仍是首帧画好之时
  setTimeout(() => showOnce('watchdog-3s'), 3000)

  // 最大化是两副面孔:贴满屏幕时圆角描边必须收掉,四角才不漏出怪缝 —— 状态一变就喊渲染进程换装
  const syncMaximized = (maximized: boolean): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('atlas:window-maximized', maximized)
  }
  mainWindow.on('maximize', () => syncMaximized(true))
  mainWindow.on('unmaximize', () => syncMaximized(false))

  // 外部链接交给系统浏览器打开,不在应用里开新窗口
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式加载 Vite 开发服务器,打包后加载本地文件
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

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
    abs = joinRoot(rootPath, relPath)
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

/** read_file 的执行手:读文本文件,超长只读开头一段并注明,绝不静默截断 */
async function agentReadFile(
  rootPath: string,
  relPath: string,
  maxChars: number
): Promise<{ ok: boolean; text: string; hint?: string }> {
  let abs: string
  try {
    abs = joinRoot(rootPath, relPath)
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

/** 每翻一样就往界面播一句大白话(挂在流式增量通道上,渲染层认 step 字段) */
function sendAgentStep(event: IpcMainInvokeEvent, requestId: string, text: string): void {
  if (requestId === '' || event.sender.isDestroyed()) return
  const payload: AiDeltaPayload = { id: requestId, text: '', step: { text } }
  event.sender.send('atlas:ai-delta', payload)
}

/** agent 流式轮次的增量转发(第一百三十四锤):思考/正文逐帧推给界面,token 账同帧喂状态条 */
function sendAgentDelta(event: IpcMainInvokeEvent, requestId: string, ev: AgentStreamEvent): void {
  if (requestId === '' || event.sender.isDestroyed()) return
  const payload: AiDeltaPayload = { id: requestId, text: ev.text ?? '' }
  if (ev.reasoning) payload.reasoning = ev.reasoning
  if (ev.stats) payload.stats = ev.stats
  if (ev.reset) payload.reset = true
  event.sender.send('atlas:ai-delta', payload)
  // 引擎肯报账,状态条的「忙」就跟着报数(和普通聊天同一待遇)
  if (ev.stats) announceActivityBusy(lastActivityProvider, ev.stats)
}

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
}): Promise<AiChatResult> {
  const { event, requestId, target, baseMessages, rootPath, ctx, replyCap, allowThinking, signal } = input
  const messages: AgentChatMessage[] = [...baseMessages]
  // 人设后面垫翻文件守则:教它何时动手、动手几次、答话照旧说人话
  const systemIdx = messages.findIndex((m) => m.role === 'system')
  if (systemIdx >= 0) messages[systemIdx] = { role: 'system', content: `${(messages[systemIdx] as { content: string }).content}${AGENT_ADDENDUM}` }
  const readChars = agentReadChars(ctx)
  const doneCalls = new Set<string>()
  let usage: AiUsage | undefined
  let reasoningAll: string | undefined
  let rounds = 0
  addDevLog('request', `翻文件模式开跑 · 最多 ${AGENT_MAX_ROUNDS} 轮 · 单次读文件约 ${readChars} 字`)
  for (;;) {
    if (signal.aborted) return agentResult(input, 'cancelled', '', usage, reasoningAll)
    const useTools = rounds < AGENT_MAX_ROUNDS
    if (!useTools) messages.push({ role: 'user', content: ROUND_CAP_NUDGE })
    rounds += 1
    const round = await agentRound(target, messages, {
      signal,
      maxTokens: replyCap,
      allowThinking,
      useTools,
      onDelta: (ev) => sendAgentDelta(event, requestId, ev)
    })
    if (round.status !== 'ok') {
      return agentResult(input, round.status === 'cancelled' ? 'cancelled' : 'error', round.text, usage, reasoningAll)
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
        return agentResult(input, 'error', '模型翻是翻了,但最后一句话没说出来 —— 再问一次试试', usage, reasoningAll)
      }
      addDevLog('request', `翻文件收工 · 第 ${rounds} 轮交卷 · 输出约 ${text.length} 字`)
      return agentResult(input, 'supported', text, usage, reasoningAll)
    }
    // 工具调用原样回填进对话(服务端要求 assistant 消息和 tool 结果成对出现)
    messages.push(raw)
    const toolResults: Array<{ role: 'tool'; tool_call_id: string; content: string }> = []
    for (const call of calls) {
      if (signal.aborted) break
      const relPath = sanitizeAgentRelPath(call.args === null ? null : call.args.relPath)
      const callName = call.name === 'read_file' || call.name === 'list_files' ? call.name : null
      if (!callName || relPath === null) {
        sendAgentStep(event, requestId, agentStepText(callName ?? 'list_files', String(call.args?.relPath ?? '(没给路径)'), 'error', callName ? '路径不合法,要用项目内的相对路径' : '没有这个工具'))
        toolResults.push({ role: 'tool', tool_call_id: call.id, content: '参数不合法:要用项目内的相对路径(如 src/index.ts),根目录传空字符串' })
        continue
      }
      const key = toolCallKey(callName, relPath)
      if (doneCalls.has(key)) {
        sendAgentStep(event, requestId, agentStepText(callName, relPath, 'repeat'))
        toolResults.push({ role: 'tool', tool_call_id: call.id, content: REPEAT_NUDGE })
        continue
      }
      doneCalls.add(key)
      const exec = callName === 'list_files' ? await agentListFiles(rootPath, relPath) : await agentReadFile(rootPath, relPath, readChars)
      sendAgentStep(event, requestId, agentStepText(callName, relPath === '' ? '(项目根目录)' : relPath, exec.ok ? 'done' : 'error', exec.hint))
      toolResults.push({ role: 'tool', tool_call_id: call.id, content: exec.text })
    }
    messages.push(...toolResults)
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
  ipcMain.handle('atlas:window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('atlas:window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('atlas:window-maximize-toggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('atlas:window-is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)

  // 弹出系统"选择文件夹"对话框,返回所选路径;取消则返回 null
  // 第八十八锤:对话框认准来叫它的那个窗,不再抓「[0]」——日志窗开着时别把弹窗挂错门
  ipcMain.handle('atlas:pick-folder', async (event) => {
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
  ipcMain.handle('atlas:list-drives', async (): Promise<DriveInfo[]> => {
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
  ipcMain.handle('atlas:app-version', () => app.getVersion())

  // ── Developer 日志(第八十七锤):拉全量 / 清账 / 开窗 ──
  ipcMain.handle('atlas:dev-log-pull', () => devLogSnapshot())
  ipcMain.handle('atlas:dev-log-clear', () => {
    clearDevLogs()
  })
  ipcMain.handle('atlas:dev-log-open', () => {
    openDevLogWindow()
  })

  // 扫描指定文件夹,返回目录树 + 统计;顺手给每个节点打大白话速览标签
  ipcMain.handle('atlas:scan-folder', async (_event, folderPath: unknown) => {
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
  ipcMain.handle('atlas:scan-subdir', (_event, rootPath: unknown, relPath: unknown) => {
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
  ipcMain.handle('atlas:analyze-file', async (_event, rootPath: unknown, relPath: unknown, languageId: unknown) => {
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
    if (stat.size > 1_000_000) return null // 超过 1MB 的源码不解析,避免卡顿
    const code = await fs.readFile(absPath, 'utf8').catch((err: NodeJS.ErrnoException) => {
      throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
    })
    return analyzeSource(code, languageId)
  })

  // 代码预览读文件(第一百一十锤):右键「预览文件」用的那条通道。
  // 路径契约同 analyze-file —— 收 (rootPath, relPath),绝对路径只经 joinRoot 解析,
  // relPath 越界(.. 上跳、盘符注入)在这儿被拦。守卫三道:二进制不受理、超大不受理、
  // 能读的也只给前一段(行数/字数双封顶),账目如实回给界面,绝不静默腰斩。
  ipcMain.handle('atlas:read-preview', async (_event, rootPath: unknown, relPath: unknown): Promise<FilePreviewResult> => {
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
      return { status: 'binary', text: '', totalLines: 0, truncated: false, reason: '这是二进制或媒体文件,里面没有能当文本看的字;想了解它的话,右栏的小探针可以按类型给你讲' }
    }
    if (stat.size > PREVIEW_MAX_BYTES) {
      return {
        status: 'too-big',
        text: '',
        totalLines: 0,
        truncated: false,
        reason: `这个文件有 ${formatSize(stat.size)},太大了,预览只伺候 ${formatSize(PREVIEW_MAX_BYTES)} 以内的文本`
      }
    }
    // 读内容也可能撞上独占/上锁(EBUSY/EPERM),走人话口径,不吐生面孔
    const buf = await fs.readFile(absPath).catch((err: NodeJS.ErrnoException) => {
      throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
    })
    // 后缀骗人的(改名的二进制)在这儿补一道:开头有 NUL 字节就不是文本
    if (looksBinary(buf.subarray(0, 8192))) {
      return { status: 'binary', text: '', totalLines: 0, truncated: false, reason: '这个文件的内容不是文本(开头就是二进制数据),预览不了' }
    }
    const clip = clipPreview(buf.toString('utf8'))
    return { status: 'ok', text: clip.text, totalLines: clip.totalLines, truncated: clip.truncated, reason: '' }
  })

  // 项目关系图:全项目谁引用谁。路径契约同 analyze-file,读文件只走 joinRoot
  ipcMain.handle('atlas:dep-graph', (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    return buildDependencyGraph(rootPath)
  })

  // AI 配置:读 / 存(双 Provider:lmstudio 与 builtin 两个分支都收)
  ipcMain.handle('atlas:ai-config-get', () => loadAiConfig(app.getPath('userData')))
  ipcMain.handle('atlas:ai-config-save', async (_event, config: unknown) => {
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
      // 个性化(第一百一十三锤)也得跟着进档:上一版在这一步被弄丢,设置完下次打开就打回原形
      personalization: sanitizePersonalization(c.personalization),
      // 手动上下文(留空 = 自动探测):上一版在这一步被弄丢,设置页填了也白填
      contextSize: typeof c.contextSize === 'number' && c.contextSize >= 512 ? c.contextSize : undefined
    })
    // 垃圾不白占:切走了内置模式,或换了模型/引擎设置,旧子进程就地解散,
    // 下次用到 AI 时按新配置重新拉起 —— 不然讲着旧模型的旧账
    if (previous.provider === 'builtin' && saved.provider !== 'builtin' && isBuiltinRunning()) {
      stopBuiltinServer()
      broadcastModelStatus(builtinIdleStatus(saved.builtin.modelPath))
    }
    if (saved.provider === 'builtin' && builtinNeedsRestart(saved.builtin)) {
      stopBuiltinServer()
      broadcastModelStatus(builtinIdleStatus(saved.builtin.modelPath))
    }
    // 换了 provider 或模型,状态栏立刻照新配置报话,不等下一轮轮询
    void refreshModelStatus().catch(() => {})
    return saved
  })

  // ── 模型状态栏(第七十锤):界面随时来问当前状态;按「取消/卸下」就地解散引擎 ──
  ipcMain.handle('atlas:model-status-get', async (): Promise<ModelStatus> => {
    const config = await loadAiConfig(app.getPath('userData'))
    if (config.provider === 'builtin') {
      // 引擎播报员有最新账就照账说;还没开播报过就拿配置兜底(上次用的模型 + 文件大小)
      return lastBuiltinStatus() ?? builtinIdleStatus(config.builtin.modelPath)
    }
    return probeLmStudioStatus(config)
  })
  ipcMain.handle('atlas:model-eject', async (): Promise<{ ok: boolean; message?: string }> => {
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
  ipcMain.handle('atlas:model-fit-check', async (_event, modelPath: unknown): Promise<ModelFitVerdict> => {
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
    const ctx = typeof config.contextSize === 'number' && config.contextSize >= 512 ? config.contextSize : DEFAULT_CONTEXT_SIZE
    return { ...judgeModelFit(sizeBytes, spec.ramBytes, spec.vramBytes, ctx), sizeBytes }
  })

  // 「AI 设置」选模型文件:引擎已内置,用户只需要挑一个 GGUF 模型(弹窗认准来叫它的窗,同上)
  ipcMain.handle('atlas:ai-pick-file', async (event) => {
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
  ipcMain.handle('atlas:ai-list-models', async (_event, baseUrl: unknown) => {
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') throw new Error('地址不能为空')
    const url = `${baseUrl.replace(/\/+$/, '')}/models`
    // 5 秒没应答就当没通:LM Studio 卡死时别让界面跟着无限转圈
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => null)
    if (!res || !res.ok) {
      throw new Error(`连不上模型服务,检查 LM Studio 是否已启动(${baseUrl})`)
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return (data.data ?? []).map((m) => m.id)
  })

  // git 改动总览:谁动了、动了多少行。不是 git 仓库时返回 isGitRepo=false,不炸
  ipcMain.handle('atlas:git-changes', (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    return collectGitChanges(rootPath)
  })

  // 人话讲解一个改动:diff 由主进程现场重取(不信任渲染进程传内容),再喂本地模型
  // 路径契约同 analyze-file:收 (rootPath, relPath),绝对路径只经 joinRoot 解析
  ipcMain.handle('atlas:git-explain-change', async (event, rootPath: unknown, relPath: unknown, requestId?: unknown) => {
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
  ipcMain.handle('atlas:git-report', async (event, rootPath: unknown, requestId?: unknown) => {
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
          resolved.budgets.replyTokens
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
  ipcMain.handle('atlas:locate-feature', async (_event, tree: unknown, question: unknown, requestId?: unknown) => {
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
    'atlas:ai-explain-file',
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
      if (isAnalysisSupported(languageId) && stat.size <= 1_000_000) {
        // 读内容也可能撞上独占/上锁(EBUSY/EPERM),同样走人话口径,不吐生面孔
        const code = await fs.readFile(absPath, 'utf8').catch((err: NodeJS.ErrnoException) => {
          throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
        })
        const structure = await analyzeSource(code, languageId)
        if (structure) {
          return respondWithEvidence(
            event,
            requestId,
            question,
            buildExplainPrompt({ relPath, name, languageName: structure.languageId, structure, graph: null, note: ownerNote, headerComment: extractHeaderComment(code) }),
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
          GUESS_SYSTEM_PROMPT,
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
        GUESS_SYSTEM_PROMPT,
        resolved,
        name
      )
    }
  )

  // 人话解释一个文件夹:目录清单就是证据;空文件夹直接本地人话,不劳烦模型
  // relPath 传 '' 表示解释项目根目录本身;自由聊天有专门的 atlas:ai-chat 通道
  ipcMain.handle(
    'atlas:ai-explain-folder',
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
      FOLDER_SYSTEM_PROMPT,
      resolved,
      folderName
    )
  })

  // 自由对话:独立通道、独立人设(Atlas 小探针)。当前选中对象的资料以「附件」身份
  // 垫在最前面,仅供参考,不进历史 —— 换对象不带旧资料,旧对话也不污染新对象。
  // 用户点名要联网(联网/搜搜/查查…)且开关开着,程序先按名字真查一份资料再开答;
  // 查询的每一步状态(查着了/没查到/没开开关)都以程序账本为准回传,模型说了不算。
  ipcMain.handle('atlas:ai-chat', async (event, req: unknown): Promise<AiChatResult> => {
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
        const found = await webLookupDetailed(query, electronFetchText)
        outcome = { kind: 'attempted', material: found.material, sources: found.sources }
        if (found.material) webMaterial = { query, material: found.material }
      } catch {
        outcome = { kind: 'error' }
      }
      const finalState = outcome.kind === 'attempted' ? (outcome.material === '' ? 'empty' : 'completed') : 'failed'
      sendChatLookup(event, requestId, finalState, outcome.kind === 'attempted' ? outcome.sources : [])
    }

    const meta = resolveWebLookupMeta(requested, enabled, outcome)
    const systemPrompt = withPersonalization(FREE_CHAT_SYSTEM_PROMPT, resolved.style)
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
    const messages = buildFreeChatMessages(systemPrompt, attachment, history, questionText2, webMaterial, codeRefs)
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
          webLookup: meta
        })
      } finally {
        if (requestId !== '') explainAborters.delete(requestId)
        if (explainAborters.size === 0) announceActivityIdle()
      }
    }
    const aborter = new AbortController()
    if (requestId !== '') explainAborters.set(requestId, aborter)
    try {
      const res = await explainWithMessages(
        resolved.target,
        messages,
        makeDeltaSender(event, requestId),
        aborter.signal,
        cap,
        { allowThinking: thinking }
      )
      // 用户主动掐掉(经 atlas:ai-cancel):如实记 cancelled,不算模型出错
      const status = aborter.signal.aborted ? 'cancelled' : res.status
      return { ...res, status, webLookup: meta }
    } finally {
      if (requestId !== '') explainAborters.delete(requestId)
      if (explainAborters.size === 0) announceActivityIdle()
    }
  })

  // 试一句(第一百一十三锤):设置页改完说话方式,拿草稿当场念一段听效果。
  // 关键在「草稿」二字 —— 走的是传进来的那份个性化,不是存档里的那份,
  // 所以还没点「应用更改」也能试,试完不满意直接退回,不用先存再改。
  ipcMain.handle('atlas:ai-style-sample', async (event, personalization: unknown, requestId?: unknown): Promise<AiExplainResult> => {
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
  ipcMain.handle('atlas:ai-cancel', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string' || requestId === '') return
    explainAborters.get(requestId)?.abort()
    explainAborters.delete(requestId)
  })

  // 联网查证(可选举手):讲解认不出软件/品牌时,拿「名字」去维基百科/DuckDuckGo 查免费公开资料。
  // 只许传名字,不许传本地路径 —— 隐私边界写在调用方;5 秒超时,查不到返回空串,上层自己回退
  ipcMain.handle('atlas:web-lookup', (_event, query: unknown) => {
    if (typeof query !== 'string' || query.trim() === '') return ''
    return webLookup(query, electronFetchText)
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

app.whenReady().then(() => {
  createWindow()
  registerIpc()

  // 后台日志广播员上岗(第八十七锤):每记一笔就推给所有窗口(日志窗口常驻收听)
  setDevLogListener((entry) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('atlas:dev-log', entry)
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
})

app.on('will-quit', () => {
  stopBuiltinServer() // 内置模型是子进程,退出时带走,不留孤儿进程占着显存
})

app.on('window-all-closed', () => {
  // Windows / Linux:关掉所有窗口就退出应用
  if (process.platform !== 'darwin') app.quit()
})
