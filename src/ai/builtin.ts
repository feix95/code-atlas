// 内置模型 Provider:把 llama-server 当独立子进程养起来。
// 它一启动就暴露 OpenAI 兼容的 HTTP API,对上层来说和 LM Studio 没区别 ——
// 都是"一个 baseURL + 一个模型名",业务代码不感知底下是谁在跑。
// 生命周期:首次用到 AI 才启动(不拖慢 app 打包体积和启动速度);app 退出时杀掉。
// 端口固定 8766,避开 LM Studio 默认的 1234。上次异常退出留下的孤儿进程,启动/用时收尸还端口。
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import os from 'node:os'
import type { AiBuiltinSettings, ModelStatus } from '../shared/types.ts'
import { DEFAULT_CONTEXT_SIZE } from '../shared/aiDefaults.ts'
import { addDevLog } from '../shared/devlog.ts'

/** 内置 llama-server 的固定端口(与 LM Studio 默认 1234 错开) */
const BUILTIN_PORT = 8766
/** 热身多久没好开始温柔提醒(第七十二锤,小葵拍板):绝不掐进程 —— 大模型从机械盘
 * 搬进显存两三分钟是常事,掐表只会杀死健康的加载;等不等由用户手里的「取消」说了算 */
const WARMUP_NUDGE_MS = 5 * 60_000
const POLL_INTERVAL_MS = 1000
/** 引擎进程名(收尸时先验明正身,绝不误杀别的程序) */
const ENGINE_IMAGE = 'llama-server.exe'

/** 当前子进程与它的就绪结果(模块级单例:整个 app 只养一个内置模型) */
let child: ChildProcess | null = null
let readyPromise: Promise<{ baseUrl: string; model: string }> | null = null
/** 当前子进程是用哪组设置拉起的(serverPath|modelPath),换模型时判断要不要重启 */
let startedKey = ''

// ── 第七十锤:模型状态播报 ──
// 引擎在干嘛(没叫醒/热身到百分之几/就绪/出岔子)由这里记账并喊给状态栏。
// progress 只在 /health 真报了数时给值,拿不到就 null,绝不编百分比。

/** 状态栏播报员:main 进程注册,状态一动就往窗口广播 */
let statusAnnouncer: ((status: ModelStatus) => void) | null = null
/** 最近一次播报(状态栏查询时的兜底) */
let lastStatus: ModelStatus | null = null
/** 主动叫停标记:取消/卸下触发的进程退出不当故障报,下次 startAndWaitReady 时复位 */
let stopping = false

/** 用户按了取消/卸下时,挂起的启动等待收到的一句话(不是故障,是「先不用了」) */
const CANCEL_MESSAGE = '加载取消了:想用的时候再问一句,它会重新热身'

export function setBuiltinStatusAnnouncer(announce: ((status: ModelStatus) => void) | null): void {
  statusAnnouncer = announce
}

/** 最近一次内置模型状态(没播报过就是 null,由调用方拿配置兜底) */
export function lastBuiltinStatus(): ModelStatus | null {
  return lastStatus
}

function builtinStatus(
  state: ModelStatus['state'],
  modelName: string,
  sizeBytes: number | null,
  progress: number | null = null,
  message?: string,
  estimated = false
): ModelStatus {
  return {
    provider: 'builtin',
    state,
    modelName,
    sizeBytes,
    progress,
    ...(estimated ? { estimated: true } : {}),
    ...(message ? { message } : {})
  }
}

// ── 热身估价小账本(第七十一锤起,第七十五锤改滚动三条)──
// 这版引擎(build 10786)加载期间 /health 不带进度、日志不打印,真百分比三头都拿不到。
// 但同一台电脑同一个模型,热身耗时相当稳 —— 记下成功热身的耗时,下次按「已用时÷均值」
// 画一条有据的估,封顶 95%(没真就绪绝不报 100),标「约」字;头一回没账就转圈。
// 只记确认加载成功的那次(取消/半路死掉的不入账);每模型滚动留最近 3 次 —— 开机第一次
// 冷读慢、之后热读快,均值把运气摊薄,坏运气只占三分之一话语权,换盘挪模型三轮就淡出去。
// 账本存 userData/model-warmup.json,这是应用自己的小账本,不碰项目文件。

/** 热身耗时账本目录(userData),main 进程启动时注入 */
let warmupDir: string | null = null

export function setBuiltinWarmupDir(dir: string): void {
  warmupDir = dir
}

/** 一本账最多记最近几次成功热身 */
const WARMUP_SAMPLES = 3

/** 账本原始内容 → 某模型的最近热身样本(纯函数,自测覆盖)。
 * 老格式(单个数)自动当一次历史;脏账(<1 秒/非数)剔除;只认最近 3 条;全脏回 null */
export function parseWarmupSamples(raw: unknown, modelPath: string): number[] | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = (raw as Record<string, unknown>)[modelPath]
  const list = typeof entry === 'number' ? [entry] : Array.isArray(entry) ? entry : []
  const samples = list
    .filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms >= 1000)
    .slice(-WARMUP_SAMPLES)
    .map((ms) => Math.round(ms))
  return samples.length > 0 ? samples : null
}

/** 样本均值(纯函数,自测覆盖):没有样本回 null,别硬估 */
export function averageWarmup(samples: number[]): number | null {
  if (samples.length === 0) return null
  return Math.round(samples.reduce((sum, ms) => sum + ms, 0) / samples.length)
}

/** 账本更新:某模型刚热身完,入一笔,只留最近 3 次(纯函数,自测覆盖;垃圾输入就地开新账) */
export function nextWarmupStore(raw: unknown, modelPath: string, ms: number): Record<string, number[]> {
  const base: Record<string, unknown> = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
  const old = parseWarmupSamples(base, modelPath) ?? []
  base[modelPath] = [...old, Math.max(1000, Math.round(ms))].slice(-WARMUP_SAMPLES)
  return base as Record<string, number[]>
}

/**
 * 热身太久的温柔提醒(纯函数,自测覆盖):5 分钟还没好才开口,一句话管理预期,
 * 绝不吓唬也绝不催命 —— 去留是用户手里「取消」的事,不是闹钟的事。
 */
export function warmupNudgeMessage(elapsedMs: number): string | undefined {
  return elapsedMs >= WARMUP_NUDGE_MS
    ? '这次热身有点久:大模型第一次要从硬盘整个搬一遍,慢是正常的;不想等就点「取消」,搬完它自己会说'
    : undefined
}

/** 热身估价公式:已用时 ÷ 最近样本均值 → 百分比,1~95 封顶(纯函数,自测覆盖)。
 * 没账可查回 null(界面转圈);宁慢勿快 —— 封顶 95,没真就绪绝不谎报到手。
 */
export function estimateLoadProgress(elapsedMs: number, lastMs: number | null): number | null {
  if (lastMs === null || !Number.isFinite(lastMs) || lastMs <= 0) return null
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1
  return Math.max(1, Math.min(95, Math.floor((elapsedMs / lastMs) * 100)))
}

function warmupFilePath(): string | null {
  return warmupDir ? join(warmupDir, 'model-warmup.json') : null
}

/** 某模型的估价基准 = 最近样本的均值;没账/坏账回 null */
function readWarmupMs(modelPath: string): number | null {
  const file = warmupFilePath()
  if (!file || !existsSync(file)) return null
  try {
    const samples = parseWarmupSamples(JSON.parse(readFileSync(file, 'utf8')), modelPath)
    return averageWarmup(samples ?? [])
  } catch {
    return null
  }
}

function recordWarmupMs(modelPath: string, ms: number): void {
  const file = warmupFilePath()
  if (!file) return
  try {
    const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
    writeFileSync(file, JSON.stringify(nextWarmupStore(raw, modelPath, ms), null, 2), 'utf8')
  } catch {
    // 账本写不进去就算了:估价是锦上添花,不该惊动任何人
  }
}

// ── 提前量尺(第七十三锤)──
// 选模型那一刻就拿「模型块头」比「机器尺寸」,带不动当场说,不让用户白等一场。

const GB = 1024 ** 3

/** 机器的家底:内存多大、显存多大(NVIDIA 卡能问到,问不到就 null,只按内存量尺) */
export interface MachineSpec {
  ramBytes: number
  vramBytes: number | null
  gpuName: string | null
}

/** nvidia-smi 的一行输出 → 显卡名 + 显存字节(纯函数,自测覆盖);认不出回 null */
export function parseNvidiaSmi(line: string): { name: string; vramBytes: number } | null {
  // 形如 "NVIDIA GeForce RTX 5060 Ti, 16311 MiB"
  const hit = line.match(/^(.+?),\s*(\d+)\s*MiB\s*$/)
  if (!hit) return null
  const mib = Number(hit[2])
  if (!Number.isFinite(mib) || mib <= 0) return null
  return { name: hit[1].trim(), vramBytes: Math.round(mib * 1024 * 1024) }
}

let machineSpecCache: MachineSpec | undefined // undefined = 还没问过

/** 问一次机器家底(显存走 nvidia-smi,N/A 显卡老实回 null);同一进程只问一遍 */
export async function queryMachineSpec(): Promise<MachineSpec> {
  if (machineSpecCache !== undefined) return machineSpecCache
  const ramBytes = os.totalmem()
  let vramBytes: number | null = null
  let gpuName: string | null = null
  try {
    const out = await runCommand('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'])
    const hit = parseNvidiaSmi(out.split('\n')[0] ?? '')
    if (hit) {
      vramBytes = hit.vramBytes
      gpuName = hit.name
    }
  } catch {
    // 没装 N 卡或没这命令:不硬编显存,量尺退回只看内存
  }
  const spec: MachineSpec = { ramBytes, vramBytes, gpuName }
  machineSpecCache = spec
  return spec
}

function formatGB(bytes: number): string {
  return `${(bytes / GB).toFixed(1).replace(/\.0$/, '')} GB`
}

export interface ModelFitVerdictPure {
  level: 'ok' | 'tight' | 'too-big'
  title: string
  detail: string
}

/**
 * 量尺公式(纯函数,自测覆盖):模型块头 vs 显存+内存。
 * 有显存:≤90% 显存 = 全进卡(最快);再往上挤到「显存+一半内存」= 能跑但落内存会慢;
 * 超过 = 必然靠硬盘硬扛,直接劝退。没问到显存:只看内存,权重超过内存七成就算挤。
 */
/** 上下文缓存(KV)的估算(纯函数,自测覆盖):光看权重块头会说「装得下」,
 * 实际跑起来上下文一占就溢出显存、预处理慢吞吞(小葵 C 盘大项目的病根)。
 * 架构细节拿不到,按模型块头分档粗估每 token 的缓存开销:≥8GB 按 64 层大模型算,
 * 4~8GB 减半,更小的再减半 —— 宁可粗,不可无;量尺的话里标明是估的。
 */
export function estimateKvBytes(contextTokens: number, modelBytes: number): number {
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return 0
  const perToken = modelBytes >= 8 * GB ? 256 * 1024 : modelBytes >= 4 * GB ? 128 * 1024 : 64 * 1024
  return Math.round(contextTokens * perToken)
}

export function judgeModelFit(
  modelBytes: number,
  ramBytes: number,
  vramBytes: number | null,
  contextTokens = DEFAULT_CONTEXT_SIZE
): ModelFitVerdictPure {
  if (vramBytes !== null && vramBytes > 0) {
    // 第八十六锤:显存是权重 + 上下文缓存一起抢的,量尺把缓存估进去再说话
    const kv = estimateKvBytes(contextTokens, modelBytes)
    const need = modelBytes + kv
    if (need <= vramBytes * 0.9) {
      return {
        level: 'ok',
        title: '装得下',
        detail: `模型 ${formatGB(modelBytes)} + 上下文缓存估 ${formatGB(kv)}(按 ${Math.round(contextTokens)} tokens)≈ ${formatGB(need)},显存 ${formatGB(vramBytes)} —— 整个进显卡,跑得动`
      }
    }
    if (need <= vramBytes + ramBytes * 0.5) {
      return {
        level: 'tight',
        title: '有点挤',
        detail: `模型 ${formatGB(modelBytes)} + 上下文缓存估 ${formatGB(kv)}(按 ${Math.round(contextTokens)} tokens)超出了显存 ${formatGB(vramBytes)},多出来的要落内存 —— 能跑,但读大材料时会明显变慢;把「模型上下文」调小能快回来`
      }
    }
    const suggest = Math.floor(Math.max(1, vramBytes * 0.9 - kv) / GB)
    return { level: 'too-big', title: '这台机器装不下', detail: `模型 ${formatGB(modelBytes)},加上上下文缓存连显存 ${formatGB(vramBytes)} 带内存一起匀也紧张 —— 建议换 ${suggest} GB 以下的模型,或加内存条` }
  }
  // 纯内存跑(问不到显存,A/老卡):量尺只答装不装得下,缓存不另估 —— 内存机型本身就慢,
  // 缓存那点开销改变不了结论,别拿估出来的数字吓人
  if (modelBytes <= ramBytes * 0.5) {
    return { level: 'ok', title: '装得下', detail: `模型 ${formatGB(modelBytes)},内存 ${formatGB(ramBytes)} —— 装得下` }
  }
  if (modelBytes <= ramBytes * 0.7) {
    return { level: 'tight', title: '有点挤', detail: `模型 ${formatGB(modelBytes)},内存 ${formatGB(ramBytes)} —— 塞得下但系统会挤,跑起来偏慢` }
  }
  const suggest = Math.floor((ramBytes * 0.5) / GB)
  return { level: 'too-big', title: '这台机器装不下', detail: `模型 ${formatGB(modelBytes)},内存只有 ${formatGB(ramBytes)} —— 建议换 ${suggest} GB 以下的模型` }
}

/**
 * 引擎「启动就死」的验尸报告(纯函数,自测覆盖):分清撑死、上下文填爆、还是文件坏了,
 * 不再一句「可能太大」糊弄所有人。撑死要拿量尺的数字说话;上下文嫌疑只在手动填大了时点。
 */
export function autopsyExitMessage(exitCode: number | null, fit: ModelFitVerdictPure, manualContext: number | null): string {
  if (fit.level === 'too-big') {
    return `模型在这台机器上装不下,引擎一启动就撑死了(退出码 ${exitCode ?? '未知'})。${fit.detail}`
  }
  if (manualContext !== null && manualContext >= 32768) {
    return `内置模型启动就退出了(退出码 ${exitCode ?? '未知'})。最常见的两个原因:①设置里「模型上下文」填得太大(当前 ${manualContext})—— 清空它,回到自动探测;②模型文件损坏 —— 重新下一个`
  }
  return `内置模型启动就退出了(退出码 ${exitCode ?? '未知'}):常见原因是模型文件损坏或被别的程序占用,重新选一个模型文件试试`
}

/** 引擎「启动就死」的专用错误:带着退出码,验尸时好认 */
export class EngineExitError extends Error {
  exitCode: number | null
  constructor(exitCode: number | null, message: string) {
    super(message)
    this.name = 'EngineExitError'
    this.exitCode = exitCode
  }
}

function announceBuiltin(status: ModelStatus): void {
  lastStatus = status
  try {
    statusAnnouncer?.(status)
  } catch {
    // 播报员打喷嚏不影响引擎干活
  }
}

function announceBuiltinError(modelPath: string, err: unknown): void {
  const facts = builtinIdleFacts(modelPath)
  announceBuiltin(builtinStatus('error', facts.modelName, facts.sizeBytes, null, err instanceof Error ? err.message : String(err)))
}

/** 没开引擎时的展示信息:上次用的模型名 + 文件多大;文件失踪就老实说,不报假数 */
export function builtinIdleFacts(modelPath: string): { modelName: string; sizeBytes: number | null; message?: string } {
  const p = modelPath.trim()
  if (!p) return { modelName: '', sizeBytes: null, message: '还没选模型:去「AI 设置」挑一个 GGUF 模型文件' }
  try {
    return { modelName: basename(p), sizeBytes: statSync(p).size }
  } catch {
    return { modelName: basename(p), sizeBytes: null, message: '模型文件找不到了(可能被挪走或删了):去「AI 设置」重新选一下' }
  }
}

/** 内置模型的「还没叫醒」状态(状态栏查询与配置保存后复位用) */
export function builtinIdleStatus(modelPath: string): ModelStatus {
  const facts = builtinIdleFacts(modelPath)
  return builtinStatus('idle', facts.modelName, facts.sizeBytes, null, facts.message)
}

/**
 * 从 /health 的 503 响应体里抠加载进度。llama.cpp 新版给
 * {"error":{"message":"Loading model","progress":0.42}},老版啥都不给。
 * 0~1 当比例 ×100,1~100 当百分数,出了范围或不是数 = 拿不到(纯函数,自测覆盖)。
 */
export function parseLoadProgress(body: unknown): number | null {
  const raw =
    typeof body === 'number'
      ? body
      : body !== null && typeof body === 'object'
        ? ((body as { progress?: unknown }).progress ?? (body as { error?: { progress?: unknown } }).error?.progress)
        : undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  if (raw <= 1) return raw * 100
  if (raw <= 100) return raw
  return null
}

export function isBuiltinRunning(): boolean {
  return child !== null && child.exitCode === null
}

function settingsKey(settings: AiBuiltinSettings): string {
  return `${settings.serverPath.trim()}|${settings.modelPath.trim()}`
}

/** 设置有变(换了模型文件或引擎路径)而旧进程还在跑:得重启才作数 */
export function builtinNeedsRestart(settings: AiBuiltinSettings): boolean {
  if (!isBuiltinRunning()) return false
  return startedKey !== settingsKey(settings)
}

/**
 * 引擎自动定位:用户不该知道 llama-server 是啥。
 * 设置里填了程序路径就用填的(高级用法);没填就找 app 自带的引擎
 * (dev 模式在项目根 vendor/llama-cpp/,打包后在 resources/llama-cpp/)。
 * 都找不到 → 人话错误,只有一个动作指引,不暴露任何术语。
 */
export function resolveServerProgram(configuredPath: string): string {
  const configured = configuredPath.trim()
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error('找不到 llama-server 程序:去「AI 设置」重新选一下程序路径')
    }
    return configured
  }
  const candidates: string[] = [join(process.cwd(), 'vendor', 'llama-cpp', 'llama-server.exe')]
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  if (typeof resourcesPath === 'string') {
    candidates.push(join(resourcesPath, 'llama-cpp', 'llama-server.exe'))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('内置引擎还没就位:把 llama-server.exe 放进应用的 vendor\\llama-cpp\\ 文件夹里就好了')
}

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      if (err) reject(err)
      else resolvePromise(stdout)
    })
  })
}

/** 从 netstat -ano 输出里找监听指定端口的 PID(纯函数,自测覆盖) */
export function parseListenerPids(netstatOut: string, port: number): number[] {
  const pids = new Set<number>()
  for (const line of netstatOut.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.includes('LISTENING')) continue
    const cols = trimmed.split(/\s+/)
    if (!(cols[1] ?? '').endsWith(`:${port}`)) continue
    const pid = Number(cols[cols.length - 1])
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids]
}

/** 从 tasklist CSV 输出里抠出进程映像名,查无此进程就空串(纯函数,自测覆盖) */
export function parseTasklistImage(tasklistOut: string): string {
  const row = tasklistOut
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('"'))
  return row?.match(/^"([^"]+)"/)?.[1] ?? ''
}

/** 8766 端口上有没有活物(llama-server 加载中回 503,也算活着) */
async function builtinPortOccupied(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${BUILTIN_PORT}/health`, { signal: AbortSignal.timeout(1500) })
    return res.status === 200 || res.status === 503
  } catch {
    return false
  }
}

async function findListenerPids(): Promise<number[]> {
  try {
    const out = await runCommand('netstat', ['-ano', '-p', 'tcp'])
    return parseListenerPids(out, BUILTIN_PORT)
  } catch {
    return []
  }
}

async function tasklistImage(pid: number): Promise<string> {
  try {
    const out = await runCommand('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
    return parseTasklistImage(out)
  } catch {
    return ''
  }
}

export interface OrphanReapResult {
  /** 是否真的击杀过孤儿进程 */
  killed: boolean
  /** 端口被别的程序占着杀不了:给出进程名,让界面说人话 */
  blockedBy?: string
}

/**
 * 收尸:崩溃或被任务管理器强杀时 will-quit 没跑,llama-server 成了孤儿,
 * 白占几个 GB 内存还堵着端口。这里找到监听 8766 的进程,验明正身才击杀;
 * 别的程序只报告不动手。非 Windows 暂不管(打包 mac 时再补对应做法)。
 */
export async function reapOrphanServer(): Promise<OrphanReapResult> {
  if (process.platform !== 'win32') return { killed: false }
  if (isBuiltinRunning()) return { killed: false }
  if (!(await builtinPortOccupied())) return { killed: false }

  let killedAny = false
  let blockedBy: string | undefined
  for (const pid of await findListenerPids()) {
    const image = await tasklistImage(pid)
    if (!image) continue
    if (image.toLowerCase() !== ENGINE_IMAGE) {
      addDevLog('system', `端口 ${BUILTIN_PORT} 被别的程序占着(${image}),不动它`)
      blockedBy = image
      continue
    }
    await runCommand('taskkill', ['/PID', String(pid), '/F']).catch(() => {})
    addDevLog('system', `收尸:请走了占着端口 ${BUILTIN_PORT} 的孤儿引擎进程(PID ${pid})`)
    killedAny = true
  }
  // 强杀后端口释放要一两秒,等它真放开再交差
  if (killedAny) {
    const deadline = Date.now() + 8000
    while (Date.now() < deadline && (await findListenerPids()).length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  return (await builtinPortOccupied())
    ? { killed: killedAny, blockedBy: blockedBy ?? ENGINE_IMAGE }
    : { killed: killedAny }
}

/**
 * 确保 llama-server 跑起来了,返回它的 ChatTarget(baseUrl + 模型名)。
 * 已在跑就直接复用;没跑就收尸清端口、拉起、轮询 /health 直到就绪、再问 /v1/models 拿模型名。
 * contextSize 是喂给引擎的上下文窗口(-c):设置里手动填了就用填的,没填按默认(shared/aiDefaults)。
 * 引擎优先用 app 自带的,用户只管选模型文件。
 * 所有失败都抛"给人看的人话",由 IPC 层原样转给界面;状态栏同步收到播报。
 */
export async function ensureBuiltinServer(
  settings: AiBuiltinSettings,
  contextSize = DEFAULT_CONTEXT_SIZE,
  manualContext: number | null = null
): Promise<{ baseUrl: string; model: string }> {
  if (isBuiltinRunning() && readyPromise) return readyPromise

  let serverPath: string
  try {
    serverPath = resolveServerProgram(settings.serverPath)
  } catch (err) {
    announceBuiltinError(settings.modelPath, err)
    throw err
  }
  const modelPath = settings.modelPath.trim()
  if (!modelPath) {
    const err = new Error('还没选模型:去「AI 设置」点「📂 选择模型」,选一个 .gguf 模型文件')
    announceBuiltinError(modelPath, err)
    throw err
  }

  // 先收尸:上次异常退出留下的孤儿还堵着端口的话,先请走再拉新的
  const reap = await reapOrphanServer()
  if (reap.blockedBy) {
    const err = new Error(`内置模型的端口 ${BUILTIN_PORT} 被别的程序占着(${reap.blockedBy}),先关掉那个程序再试`)
    announceBuiltinError(modelPath, err)
    throw err
  }

  const baseUrl = `http://127.0.0.1:${BUILTIN_PORT}/v1`
  readyPromise = startAndWaitReady(serverPath, modelPath, baseUrl, contextSize)
  try {
    const target = await readyPromise
    return target
  } catch (err) {
    // 启动失败:清干净现场,下次再试能重新拉起;用户主动叫停的算「还没叫醒」,真出错的才报故障
    const facts = builtinIdleFacts(modelPath)
    if (stopping) {
      announceBuiltin(builtinStatus('idle', facts.modelName, facts.sizeBytes, null, CANCEL_MESSAGE))
    } else {
      // 验尸(第七十三锤):启动就死的,拿量尺分清「撑死/上下文填爆/文件坏」,不再一句「可能太大」糊弄人
      if (err instanceof EngineExitError) {
        const spec = await queryMachineSpec()
        err.message = autopsyExitMessage(err.exitCode, judgeModelFit(facts.sizeBytes ?? 0, spec.ramBytes, spec.vramBytes, Math.max(512, Math.floor(contextSize))), manualContext)
      }
      announceBuiltinError(modelPath, err)
    }
    stopBuiltinServer()
    throw err
  }
}

/** 就绪后问服务加载了哪个模型(llama-server 以模型文件名作为模型 id) */
async function fetchModelId(baseUrl: string): Promise<string> {
  const modelsRes = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) })
  if (!modelsRes.ok) {
    throw new Error(`内置模型已就绪,但拿不到模型信息(${modelsRes.status}),再点一次试试`)
  }
  const data = (await modelsRes.json()) as { data?: Array<{ id?: string }> }
  const model = data.data?.[0]?.id ?? ''
  if (!model) throw new Error('内置模型已就绪,但报告不出模型名,再点一次试试')
  return model
}

async function startAndWaitReady(
  serverPath: string,
  modelPath: string,
  baseUrl: string,
  contextSize = DEFAULT_CONTEXT_SIZE
): Promise<{ baseUrl: string; model: string }> {
  startedKey = settingsKey({ serverPath, modelPath })
  stopping = false // 新的一轮启动:上次「主动叫停」的标记就地清账
  const facts = builtinIdleFacts(modelPath)
  const startedAt = Date.now()
  const lastWarmupMs = readWarmupMs(modelPath)
  // 第八十七锤:引擎要干什么,先在后台日志里亮个底 —— 参数全摆出来,LM Studio 同款透明度
  addDevLog(
    'system',
    `启动内置引擎:${serverPath} · 模型 ${modelPath} · 上下文 ${Math.max(512, Math.floor(contextSize))} · 全层上显卡(-ngl 999) · 端口 ${BUILTIN_PORT} · 工具模板(--jinja)`
  )
  child = spawn(
    serverPath,
    [
      '-m',
      modelPath,
      '--port',
      String(BUILTIN_PORT),
      '--host',
      '127.0.0.1',
      '-c',
      String(Math.max(512, Math.floor(contextSize))),
      '-ngl',
      '999',
      // --jinja(第一百二十八锤):让引擎用模型自带的对话模板,工具调用(agent 的
      // 翻文件)靠它才开得了;chat_template_kwargs 的思考开关也走这条路。换模型后生效
      '--jinja'
    ],
    {
      windowsHide: true,
      // 第八十七锤:stdout/stderr 接管(原来直接扔)—— 引擎的原话进 Developer 日志窗口
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  // 引擎吐的每一行原话都进账本:llama.cpp 把日志几乎全写在 stderr(模型结构、显存分配、
  // 加载耗时……),stdout 偶尔也有;两个管道都接,进度条的回车刷新按行拆开
  const feedEngineStream = (stream: NodeJS.ReadableStream | null): void => {
    if (!stream) return
    let leftover = ''
    stream.on('data', (chunk: Buffer) => {
      leftover += chunk.toString('utf8')
      const lines = leftover.split(/\r\n|\r|\n/)
      leftover = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) addDevLog('engine', line)
      }
    })
    stream.on('end', () => {
      if (leftover.trim()) addDevLog('engine', leftover)
    })
  }
  feedEngineStream(child.stdout)
  feedEngineStream(child.stderr)
  const announceLoading = (realProgress: number | null): void => {
    const elapsed = Date.now() - startedAt
    const est = realProgress ?? estimateLoadProgress(elapsed, lastWarmupMs)
    announceBuiltin(
      builtinStatus('loading', facts.modelName, facts.sizeBytes, est, warmupNudgeMessage(elapsed), est !== null && realProgress === null)
    )
  }
  announceLoading(null)

  // 子进程半路夭折(路径不对、缺 DLL、端口被占)→ 挂起的等待直接收到人话错误;
  // 是用户自己按的取消/卸下就说「取消了」,别吓人。带退出码的专用错误,验尸时好认
  const exitError = new Promise<never>((_, reject) => {
    child?.once('exit', (code) => {
      addDevLog('system', stopping ? `引擎已停止(主动叫停,退出码 ${code ?? '未知'})` : `引擎启动就退出了(退出码 ${code ?? '未知'})`)
      reject(
        new EngineExitError(
          code ?? null,
          stopping
            ? CANCEL_MESSAGE
            : `内置模型程序启动失败就退出了(退出码 ${code ?? '未知'}):常见原因是程序路径没指对、模型文件损坏,或端口被占用`
        )
      )
    })
    child?.once('error', (err) => {
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
    // 不设闹钟(第七十二锤):进程活着就一直等 —— 机械盘搬 14GB 模型两三分钟是常事,
    // 2 分钟的硬超时只会掐死健康的加载;真死锁交给用户手里的「取消」
    while (isBuiltinRunning()) {
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
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
    if (!isBuiltinRunning()) throw new EngineExitError(null, '内置模型进程提前退出了,检查路径和模型文件')

    // 热身真耗时入账:下次同一模型的估价就有据可依
    recordWarmupMs(modelPath, Date.now() - startedAt)
    addDevLog('system', `引擎就绪:模型加载完成,耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`)

    // 就绪后问它加载了哪个模型;刚就绪就断线的话给人话兜底
    let model: string
    try {
      model = await fetchModelId(baseUrl)
    } catch (err) {
      throw err instanceof Error && err.message.includes('内置模型')
        ? err
        : new Error('内置模型刚就绪就没了响应,再点一次试试')
    }
    announceBuiltin(builtinStatus('ready', model, facts.sizeBytes, 100))

    // 就绪之后再夭折(跑着跑着崩了):状态栏如实报故障,下次提问会自动重新拉起;
    // 用户主动卸下的不算,走 stopping 标记闭嘴
    child?.once('exit', (code) => {
      addDevLog('system', stopping ? `引擎已停止(主动叫停,退出码 ${code ?? '未知'})` : `引擎中途退出了(退出码 ${code ?? '未知'})`)
      if (!stopping) {
        announceBuiltin(
          builtinStatus('error', model, facts.sizeBytes, null, `内置模型中途退出了(退出码 ${code ?? '未知'}),下次提问会自动重新启动`)
        )
      }
    })
    return { baseUrl, model }
  })()

  // 谁先出结果听谁的:就绪 or 进程夭折
  return Promise.race([ready, exitError])
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
}
