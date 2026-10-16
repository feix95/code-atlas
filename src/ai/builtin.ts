// 内置模型 Provider:把 llama-server 当独立子进程养起来。
// 它一启动就暴露 OpenAI 兼容的 HTTP API,对上层来说和 LM Studio 没区别 ——
// 都是"一个 baseURL + 一个模型名",业务代码不感知底下是谁在跑。
// 生命周期:首次用到 AI 才启动(不拖慢 app 打包体积和启动速度);app 退出时杀掉。
// 端口固定 8766,避开 LM Studio 默认的 1234。上次异常退出留下的孤儿进程,启动/用时收尸还端口。
import { execFile, type ChildProcess } from 'node:child_process'
import { existsSync, rmSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, join } from 'node:path'
import os from 'node:os'
import type { AiBuiltinSettings, GgufShape, ModelStatus, VisionSupport } from '../shared/types.ts'
import { DEFAULT_CONTEXT_SIZE, normalizeContextSize } from '../shared/aiDefaults.ts'
import { estimateKvBytes, formatGB } from '../shared/contextBill.ts'
import {
  MODEL_FIT_RAM_MAX_RATIO,
  MODEL_FIT_RAM_OK_RATIO,
  MODEL_FIT_VRAM_RATIO
} from '../shared/modelShelf.ts'
import { parseGgufHeader } from '../shared/gguf.ts'
import { addDevLog } from '../shared/devlog.ts'
import { readJsonFile, writeJsonFile } from '../shared/jsonFile.ts'
import { findMmprojFor, shouldRetryWithoutMmproj } from './mmproj.ts'
import {
  BUILTIN_PORT,
  CANCEL_MESSAGE,
  EngineExitError,
  launchBuiltinServer,
  type BuiltinLaunchHost
} from './builtinLaunch.ts'

// 上下文缓存(KV)的估算搬去 shared/contextBill.ts 了(档位账本跟滑块共用一份);
// 启动那摊(spawn/health 轮询/热身账本/能力探测)搬去 ai/builtinLaunch.ts ——
// 这里转一手,老朋友(量尺/自测/main 进程)照旧从 builtin 进
export { estimateKvBytes }
export {
  warmupNudgeMessage,
  estimateLoadProgress,
  parseLoadProgress,
  parseGpuOffloadReport,
  gpuOffloadWarning,
  EngineExitError
} from './builtinLaunch.ts'
export type { GpuOffloadReport } from './builtinLaunch.ts'

/** 引擎进程名(收尸时先验明正身,绝不误杀别的程序) */
const ENGINE_IMAGE = 'llama-server.exe'

/** 当前子进程与它的就绪结果(模块级单例:整个 app 只养一个内置模型) */
let child: ChildProcess | null = null
let readyPromise: Promise<{ baseUrl: string; model: string }> | null = null
/** 当前子进程是用哪组设置拉起的(serverPath|modelPath),换模型时判断要不要重启 */
let startedKey = ''
/** 当前子进程实际喂给 -c 的上下文档位(归一后的数),改档位时判断要不要重启(2026-09-13) */
let startedCtx = 0
/** 当前子进程实际喂给 --mmproj 的路径(空串 = 没带眼睛);模型旁增删 mmproj 后要按新参数重启 */
let startedMmproj = ''

// ── 第七十锤:模型状态播报 ──
// 引擎在干嘛(没叫醒/热身到百分之几/就绪/出岔子)由这里记账并喊给状态栏。
// progress 只在 /health 真报了数时给值,拿不到就 null,绝不编百分比。

/** 状态栏播报员:main 进程注册,状态一动就往窗口广播 */
let statusAnnouncer: ((status: ModelStatus) => void) | null = null
/** 最近一次播报(状态栏查询时的兜底) */
let lastStatus: ModelStatus | null = null
/** 主动叫停标记:取消/卸下触发的进程退出不当故障报,下次启动时复位 */
let stopping = false

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
  estimated = false,
  vision?: VisionSupport
): ModelStatus {
  return {
    provider: 'builtin',
    state,
    modelName,
    sizeBytes,
    progress,
    ...(estimated ? { estimated: true } : {}),
    ...(message ? { message } : {}),
    ...(vision !== undefined && vision !== 'unknown' ? { vision } : {})
  }
}

// ── 热身估价小账本(第七十一锤起,第七十五锤改滚动三条)──
// 这版引擎(build 10786)加载期间 /health 不带进度、日志不打印,真百分比三头都拿不到。
// 但同一台电脑同一个模型,热身耗时相当稳 —— 记下成功热身的耗时,下次按「已用时÷均值」
// 画一条有据的估,封顶 95%(没真就绪绝不报 100),标「约」字;头一回没账就转圈。
// 只记确认加载成功的那次(取消/半路死掉的不入账);每模型滚动留最近 3 次 —— 开机第一次
// 冷读慢、之后热读快,均值把运气摊薄,坏运气只占三分之一话语权,换盘挪模型三轮就淡出去。
// 账本存 userData/model-warmup.json,这是应用自己的小账本,不碰项目文件。
// (估价/提醒的纯函数在 builtinLaunch.ts;目录注入与读写留这边 —— 引擎 PID 档共用同一目录)

/** 应用数据目录(userData),main 进程启动时注入;热身账本与引擎 PID 档都落这里 */
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
export function nextWarmupStore(
  raw: unknown,
  modelPath: string,
  ms: number
): Record<string, number[]> {
  const base: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
  const old = parseWarmupSamples(base, modelPath) ?? []
  base[modelPath] = [...old, Math.max(1000, Math.round(ms))].slice(-WARMUP_SAMPLES)
  return base as Record<string, number[]>
}

function warmupFilePath(): string | null {
  return warmupDir ? join(warmupDir, 'model-warmup.json') : null
}

/** 某模型的估价基准 = 最近样本的均值;没账/坏账回 null */
function readWarmupMs(modelPath: string): number | null {
  const file = warmupFilePath()
  if (!file) return null
  const samples = parseWarmupSamples(readJsonFile(file), modelPath)
  return averageWarmup(samples ?? [])
}

function recordWarmupMs(modelPath: string, ms: number): void {
  const file = warmupFilePath()
  if (!file) return
  const raw = readJsonFile(file) ?? {}
  writeJsonFile(file, nextWarmupStore(raw, modelPath, ms))
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
    const out = await runCommand('nvidia-smi', [
      '--query-gpu=name,memory.total',
      '--format=csv,noheader'
    ])
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
/**
 * 翻模型档案(GGUF 头):出厂上下文上限、层数、头数 —— 档位滑块拿它封顶,
 * 黑板账拿它精算。翻不出来(不是 GGUF / 头部超长 / 读失败)老实回 null,不拦人。
 * 头部从 2MB 起步逐级加码读:词表大条目可能把头部顶到几 MB 开外。
 */
const GGUF_HEAD_SIZES = [2 * 1024 * 1024, 16 * 1024 * 1024, 128 * 1024 * 1024]

export async function readModelShape(modelPath: string): Promise<GgufShape | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(modelPath, 'r')
    const fileSize = (await handle.stat()).size
    for (const size of GGUF_HEAD_SIZES) {
      const len = Math.min(size, fileSize)
      const buf = Buffer.alloc(len)
      const { bytesRead } = await handle.read(buf, 0, len, 0)
      if (bytesRead < len) return null
      const parsed = parseGgufHeader(buf)
      if (parsed.status === 'ok') return parsed.shape
      if (parsed.status === 'bad') return null
    }
    return null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
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
    if (need <= vramBytes * MODEL_FIT_VRAM_RATIO) {
      return {
        level: 'ok',
        title: '装得下',
        detail: `模型 ${formatGB(modelBytes)} + 上下文缓存估 ${formatGB(kv)}(按 ${Math.round(contextTokens)} tokens)≈ ${formatGB(need)},显存 ${formatGB(vramBytes)} —— 整个进显卡,跑得动`
      }
    }
    if (need <= vramBytes + ramBytes * MODEL_FIT_RAM_OK_RATIO) {
      return {
        level: 'tight',
        title: '有点挤',
        detail: `模型 ${formatGB(modelBytes)} + 上下文缓存估 ${formatGB(kv)}(按 ${Math.round(contextTokens)} tokens)超出了显存 ${formatGB(vramBytes)},多出来的要落内存 —— 能跑,但读大材料时会明显变慢;把「模型上下文」调小能快回来`
      }
    }
    const suggest = Math.floor(Math.max(1, vramBytes * MODEL_FIT_VRAM_RATIO - kv) / GB)
    return {
      level: 'too-big',
      title: '这台机器装不下',
      detail: `模型 ${formatGB(modelBytes)},加上上下文缓存连显存 ${formatGB(vramBytes)} 带内存一起匀也紧张 —— 建议换 ${suggest} GB 以下的模型,或加内存条`
    }
  }
  // 纯内存跑(问不到显存,A/老卡):量尺只答装不装得下,缓存不另估 —— 内存机型本身就慢,
  // 缓存那点开销改变不了结论,别拿估出来的数字吓人
  if (modelBytes <= ramBytes * MODEL_FIT_RAM_OK_RATIO) {
    return {
      level: 'ok',
      title: '装得下',
      detail: `模型 ${formatGB(modelBytes)},内存 ${formatGB(ramBytes)} —— 装得下`
    }
  }
  if (modelBytes <= ramBytes * MODEL_FIT_RAM_MAX_RATIO) {
    return {
      level: 'tight',
      title: '有点挤',
      detail: `模型 ${formatGB(modelBytes)},内存 ${formatGB(ramBytes)} —— 塞得下但系统会挤,跑起来偏慢`
    }
  }
  const suggest = Math.floor((ramBytes * MODEL_FIT_RAM_OK_RATIO) / GB)
  return {
    level: 'too-big',
    title: '这台机器装不下',
    detail: `模型 ${formatGB(modelBytes)},内存只有 ${formatGB(ramBytes)} —— 建议换 ${suggest} GB 以下的模型`
  }
}

/**
 * 引擎「启动就死」的验尸报告(纯函数,自测覆盖):分清撑死、上下文填爆、还是文件坏了,
 * 不再一句「可能太大」糊弄所有人。撑死要拿量尺的数字说话;上下文嫌疑只在手动填大了时点。
 */
export function autopsyExitMessage(
  exitCode: number | null,
  fit: ModelFitVerdictPure,
  manualContext: number | null
): string {
  if (fit.level === 'too-big') {
    return `模型在这台机器上装不下,引擎一启动就撑死了(退出码 ${exitCode ?? '未知'})。${fit.detail}`
  }
  if (manualContext !== null && manualContext >= 32768) {
    return `内置模型启动就退出了(退出码 ${exitCode ?? '未知'})。最常见的两个原因:①设置里「模型上下文」填得太大(当前 ${manualContext})—— 清空它,回到自动探测;②模型文件损坏 —— 重新下一个`
  }
  return `内置模型启动就退出了(退出码 ${exitCode ?? '未知'}):常见原因是模型文件损坏或被别的程序占用,重新选一个模型文件试试`
}

/** 引擎「启动就死」的专用错误:带着退出码,验尸时好认 */
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
  announceBuiltin(
    builtinStatus(
      'error',
      facts.modelName,
      facts.sizeBytes,
      null,
      err instanceof Error ? err.message : String(err)
    )
  )
}

/** 没开引擎时的展示信息:上次用的模型名 + 文件多大;文件失踪就老实说,不报假数 */
export function builtinIdleFacts(modelPath: string): {
  modelName: string
  sizeBytes: number | null
  message?: string
} {
  const p = modelPath.trim()
  if (!p)
    return {
      modelName: '',
      sizeBytes: null,
      message: '还没选模型:去「AI 设置」挑一个 GGUF 模型文件'
    }
  try {
    return { modelName: basename(p), sizeBytes: statSync(p).size }
  } catch {
    return {
      modelName: basename(p),
      sizeBytes: null,
      message: '模型文件找不到了(可能被挪走或删了):去「AI 设置」重新选一下'
    }
  }
}

/** 内置模型当前能不能看图(图片附件闸用,第一百五十二锤):
 *  跑着/就绪的引擎自己报过账最可信(/props 探测的实话);没起或还在加载时,
 *  按模型旁的 mmproj 户口判意图 —— 有投影仪就是奔着视觉去的,文件在但引擎还没带上它
 *  会由 builtinNeedsRestart 重启补齐;没模型文件可判时老实说 unknown */
export function builtinVisionSupport(modelPath: string): VisionSupport {
  const live = lastStatus
  if (live && (live.state === 'ready' || live.state === 'busy') && live.vision === 'vision')
    return 'vision'
  if (modelPath.trim() === '') return 'unknown'
  return findMmprojFor(modelPath) !== null ? 'vision' : 'text-only'
}

/** 内置模型的「还没叫醒」状态(状态栏查询与配置保存后复位用) */
export function builtinIdleStatus(modelPath: string): ModelStatus {
  const facts = builtinIdleFacts(modelPath)
  // 引擎没起时按 mmproj 户口认能力:有投影仪→视觉,没有→纯文本(拿不准的留 unknown)
  const vision =
    modelPath.trim() === '' ? 'unknown' : findMmprojFor(modelPath) !== null ? 'vision' : 'text-only'
  return builtinStatus('idle', facts.modelName, facts.sizeBytes, null, facts.message, false, vision)
}

export function isBuiltinRunning(): boolean {
  return child !== null && child.exitCode === null
}

function settingsKey(settings: AiBuiltinSettings): string {
  return `${settings.serverPath.trim()}|${settings.modelPath.trim()}`
}

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
/**
 * 引擎自动定位:用户不该知道 llama-server 是啥。
 * 设置里填了程序路径就用填的(高级用法);没填就找 app 自带的引擎
 * (dev 模式在项目根 vendor/llama-cpp/,打包后在 resources/llama-cpp/)。
 * 都找不到 → 人话错误,按运行环境分一句可执行的指引:
 * 开发版(defaultApp)指去 vendor/llama-cpp 放引擎;正式版引擎是打包自带的,
 * 丢了等于安装坏了,让重装。两条都附 LM Studio 退路,不暴露路径给小白猜。
 */
export function resolveServerProgram(configuredPath: string): string {
  const configured = configuredPath.trim()
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error('找不到 llama-server 程序:去「AI 设置」重新选一下程序路径')
    }
    return configured
  }
  const candidates: string[] = [join(process.cwd(), 'vendor', 'llama-cpp', ENGINE_IMAGE)]
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  if (typeof resourcesPath === 'string') {
    candidates.push(join(resourcesPath, 'llama-cpp', ENGINE_IMAGE))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  const isDev = (process as { defaultApp?: boolean }).defaultApp === true
  throw new Error(
    isDev
      ? '没找到内置 AI 引擎,内置模型暂时用不了。请把引擎文件(llama-server.exe)放进项目根目录的 vendor\\llama-cpp\\ 文件夹;或打开「设置 → 高级选项」改用 LM Studio。'
      : '没找到内置 AI 引擎,内置模型暂时用不了。请重新安装应用;或打开「设置 → 高级选项」改用 LM Studio。'
  )
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

// ── 引擎 PID 档(收尸盲区修复,2026-09-18)──
// 病根:reapOrphanServer 只认「正在监听 8766」的进程;可引擎加载的那几秒还没开始
// listen —— 死在加载阶段的孤儿永远收不到尸,白占十几 GB 显存内存,下次再拉一份
// 就是双倍账单(2026-09-18 全机卡死案的放大器)。
// 治法:spawn 成功就把 child.pid 落盘(userData/engine-running.json);引擎一退就删档。
// app 被强杀时档和引擎一起留下 —— 下次启动照档验尸:PID 活着且映像名是
// llama-server.exe 才收;不在或被别的程序复用只清档不动手,绝不误杀。

function enginePidPath(): string | null {
  return warmupDir ? join(warmupDir, 'engine-running.json') : null
}

/** PID 档认读(纯函数,自测覆盖):只认正整数 pid,变形/垃圾回 null */
export function parseEnginePidFile(raw: unknown): number | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const pid = (raw as Record<string, unknown>)['pid']
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null
}

function writeEnginePidFile(pid: number): void {
  const file = enginePidPath()
  if (!file) return
  writeJsonFile(file, { pid })
}

function removePidFile(file: string): void {
  try {
    rmSync(file, { force: true })
  } catch {
    // 删不动就算了
  }
}

/** 引擎退出时删档:只认「档里记的正是这个 pid」才删 —— 换模型重启的竞态里,
 * 旧引擎晚死不能把新引擎刚写的档带走 */
function clearEnginePidFileFor(pid: number | undefined): void {
  const file = enginePidPath()
  if (!file || pid === undefined || !existsSync(file)) return
  if (parseEnginePidFile(readJsonFile(file)) === pid) removePidFile(file)
}

/** 照 PID 档收尸:上次拉起没收场的引擎(含死在加载中没 listen 的) */
async function reapOrphanByPidFile(): Promise<boolean> {
  const file = enginePidPath()
  if (!file || !existsSync(file)) return false
  const pid = parseEnginePidFile(readJsonFile(file))
  if (pid === null) {
    removePidFile(file)
    return false
  }
  const image = await tasklistImage(pid)
  if (image.toLowerCase() !== ENGINE_IMAGE) {
    // PID 不在或被别的程序复用:绝不是我们的引擎,只清档不动手
    removePidFile(file)
    return false
  }
  addDevLog('system', `记录中的模型进程仍在运行(PID ${pid});无法确认归属,不会自动关闭`)
  return false
}

export interface OrphanReapResult {
  /** 是否真的击杀过孤儿进程 */
  killed: boolean
  /** 端口被别的程序占着杀不了:给出进程名,让界面说人话 */
  blockedBy?: string
}

export async function inspectBuiltinConflict(probe: {
  listeners: () => Promise<number[]>
  image: (pid: number) => Promise<string>
}): Promise<OrphanReapResult> {
  const pids = await probe.listeners()
  if (pids.length === 0) return { killed: false }
  const image = await probe.image(pids[0])
  return { killed: false, blockedBy: image || '另一个程序' }
}

/**
 * 收尸:崩溃或被任务管理器强杀时 will-quit 没跑,llama-server 成了孤儿,
 * 白占几个 GB 内存还堵着端口。双路抓:先照 PID 档抓「死在加载中没 listen」的,
 * 再按老规矩查端口上的监听者;都验明正身才击杀,别的程序只报告不动手。
 * 非 Windows 暂不管(打包 mac 时再补对应做法)。
 */
export async function reapOrphanServer(): Promise<OrphanReapResult> {
  if (process.platform !== 'win32' || isBuiltinRunning()) return { killed: false }
  await reapOrphanByPidFile()
  // 强杀后端口释放要一两秒,等它真放开再交差
  return inspectBuiltinConflict({ listeners: findListenerPids, image: tasklistImage })
}

/**
 * 单飞闸门(纯函数,自测覆盖,第一百三十六锤):同一时刻只放一个任务进场,
 * 后到的调用直接等同一份承诺 —— 哪怕参数不同(引擎一个 app 只养一份,
 * 后到的就地等第一份,不自己再拉)。任务收场(成或败)闸门自动放行。
 * 修的病:两个请求同秒到达时,旧的「先检查后启动」两头都看见引擎没起,
 * 各自 spawn 一份 llama-server,同一个模型往内存装两遍(实测一晚吃掉 29GB)。
 */
export function createSingleFlight<A extends unknown[], T>(
  task: (...args: A) => Promise<T>
): (...args: A) => Promise<T> {
  let inFlight: Promise<T> | null = null
  return (...args: A) => {
    if (inFlight) return inFlight
    const running = task(...args)
    inFlight = running
    const release = (): void => {
      if (inFlight === running) inFlight = null
    }
    running.then(release, release)
    return running
  }
}

const startBuiltinSingleFlight = createSingleFlight(
  async (
    settings: AiBuiltinSettings,
    contextSize: number,
    manualContext: number | null
  ): Promise<{ baseUrl: string; model: string }> => {
    const modelPath = settings.modelPath.trim()
    if (!modelPath) {
      const err = new Error('还没设置 AI。打开设置,选择一个本地模型;不设置也能浏览项目地图。')
      announceBuiltinError(modelPath, err)
      throw err
    }
    let serverPath: string
    try {
      serverPath = resolveServerProgram(settings.serverPath)
    } catch (err) {
      announceBuiltinError(settings.modelPath, err)
      throw err
    }

    // 先收尸:上次异常退出留下的孤儿还堵着端口的话,先请走再拉新的
    const reap = await reapOrphanServer()
    if (reap.blockedBy) {
      const err = new Error(
        '另一个程序正在使用本地模型服务。CodeAtlas 没有关闭它;请先在那个程序里停止模型,或到设置连接已有的本地服务。'
      )
      announceBuiltinError(modelPath, err)
      throw err
    }

    const baseUrl = `http://127.0.0.1:${BUILTIN_PORT}/v1`
    readyPromise = startAndWaitReady(serverPath, modelPath, baseUrl, contextSize)
    try {
      const target = await readyPromise
      return target
    } catch (err) {
      // 保险丝(视觉能力锤):带了 --mmproj、引擎却「自己退了」型失败 → 投影仪跟模型
      // 对不上账,摘掉它按纯文本重拉一次;只兜这一次,第二次仍失败照常验尸上报,
      // 别把模型损坏/显存不够这类真错吞掉。用户主动叫停的不降级。
      const engineExited = err instanceof EngineExitError
      let finalErr = err
      if (!stopping && shouldRetryWithoutMmproj(startedMmproj || null, engineExited)) {
        addDevLog('system', `视觉投影仪加载失败(${startedMmproj}),摘掉 --mmproj 按纯文本重拉一次`)
        readyPromise = startAndWaitReady(serverPath, modelPath, baseUrl, contextSize, true)
        try {
          return await readyPromise
        } catch (retryErr) {
          finalErr = retryErr // 降级重拉也挂了:落回下面的验尸/上报,人话照实说
        }
      }
      // 启动失败:清干净现场,下次再试能重新拉起;用户主动叫停的算「还没叫醒」,真出错的才报故障
      const facts = builtinIdleFacts(modelPath)
      if (stopping) {
        announceBuiltin(
          builtinStatus('idle', facts.modelName, facts.sizeBytes, null, CANCEL_MESSAGE)
        )
      } else {
        // 验尸(第七十三锤):启动就死的,拿量尺分清「撑死/上下文填爆/文件坏」,不再一句「可能太大」糊弄人
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
 * 绝不双生,第一百三十六锤):收尸清端口、拉起、轮询 /health 直到就绪、再问 /v1/models 拿模型名。
 * contextSize 是喂给引擎的上下文窗口(-c):设置里手动填了就用填的,没填按默认(shared/aiDefaults)。
 * 引擎优先用 app 自带的,用户只管选模型文件。
 * 所有失败都抛"给人看的人话",由 IPC 层原样转给界面;状态栏同步收到播报。
 */
export async function ensureBuiltinServer(
  settings: AiBuiltinSettings,
  contextSize = DEFAULT_CONTEXT_SIZE,
  manualContext: number | null = null
): Promise<{ baseUrl: string; model: string }> {
  if (isBuiltinRunning() && readyPromise) {
    // 参数对不上账就解散重拉:上下文档位对不上(2026-09-13 白屏案),或模型旁的
    // mmproj 增删了(引擎还按旧参数跑,新眼睛白放)—— 单飞开头会收尸并等端口放行
    const ctxDiffers = builtinContextDiffers(contextSize)
    const mmprojDiffers = builtinMmprojDiffers(settings.modelPath)
    if (!ctxDiffers && !mmprojDiffers) return readyPromise
    addDevLog(
      'system',
      ctxDiffers
        ? `上下文档位改成了 ${normalizeContextSize(contextSize)},重启引擎让它生效`
        : '模型旁的 mmproj 文件变了,重启引擎带上新参数'
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
  setChild: (c) => {
    child = c
  },
  isEngineRunning: isBuiltinRunning,
  isStopping: () => stopping,
  resetStopping: () => {
    stopping = false
  },
  markStarted: (ctxSize, mmprojPath) => {
    startedCtx = ctxSize
    startedMmproj = mmprojPath
  },
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
  skipMmproj = false
): Promise<{ baseUrl: string; model: string }> {
  startedKey = settingsKey({ serverPath, modelPath })
  return launchBuiltinServer(launchHost, serverPath, modelPath, baseUrl, contextSize, skipMmproj)
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
}
