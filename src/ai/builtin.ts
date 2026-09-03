// 内置模型 Provider:把 llama-server 当独立子进程养起来。
// 它一启动就暴露 OpenAI 兼容的 HTTP API,对上层来说和 LM Studio 没区别 ——
// 都是"一个 baseURL + 一个模型名",业务代码不感知底下是谁在跑。
// 生命周期:首次用到 AI 才启动(不拖慢 app 打包体积和启动速度);app 退出时杀掉。
// 端口固定 8766,避开 LM Studio 默认的 1234。上次异常退出留下的孤儿进程,启动/用时收尸还端口。
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AiBuiltinSettings } from '../shared/types.ts'

/** 内置 llama-server 的固定端口(与 LM Studio 默认 1234 错开) */
const BUILTIN_PORT = 8766
/** 就绪等待上限:大模型首次加载要往显存/内存里灌几个 GB,给足耐心 */
const READY_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 1000
/** 引擎进程名(收尸时先验明正身,绝不误杀别的程序) */
const ENGINE_IMAGE = 'llama-server.exe'

/** 当前子进程与它的就绪结果(模块级单例:整个 app 只养一个内置模型) */
let child: ChildProcess | null = null
let readyPromise: Promise<{ baseUrl: string; model: string }> | null = null
/** 当前子进程是用哪组设置拉起的(serverPath|modelPath),换模型时判断要不要重启 */
let startedKey = ''

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
      blockedBy = image
      continue
    }
    await runCommand('taskkill', ['/PID', String(pid), '/F']).catch(() => {})
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
 * 引擎优先用 app 自带的,用户只管选模型文件。
 * 所有失败都抛"给人看的人话",由 IPC 层原样转给界面。
 */
export async function ensureBuiltinServer(settings: AiBuiltinSettings): Promise<{ baseUrl: string; model: string }> {
  if (isBuiltinRunning() && readyPromise) return readyPromise

  const serverPath = resolveServerProgram(settings.serverPath)
  const modelPath = settings.modelPath.trim()
  if (!modelPath) {
    throw new Error('还没选模型:去「AI 设置」点「📂 选择模型」,选一个 .gguf 模型文件')
  }

  // 先收尸:上次异常退出留下的孤儿还堵着端口的话,先请走再拉新的
  const reap = await reapOrphanServer()
  if (reap.blockedBy) {
    throw new Error(`内置模型的端口 ${BUILTIN_PORT} 被别的程序占着(${reap.blockedBy}),先关掉那个程序再试`)
  }

  const baseUrl = `http://127.0.0.1:${BUILTIN_PORT}/v1`
  readyPromise = startAndWaitReady(serverPath, modelPath, baseUrl)
  try {
    const target = await readyPromise
    return target
  } catch (err) {
    // 启动失败:清干净现场,下次再试能重新拉起
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

async function startAndWaitReady(serverPath: string, modelPath: string, baseUrl: string): Promise<{ baseUrl: string; model: string }> {
  startedKey = settingsKey({ serverPath, modelPath })
  child = spawn(serverPath, ['-m', modelPath, '--port', String(BUILTIN_PORT), '--host', '127.0.0.1', '-c', '4096', '-ngl', '999'], {
    windowsHide: true,
    stdio: 'ignore'
  })

  // 子进程半路夭折(路径不对、缺 DLL、端口被占)→ 挂起的等待直接收到人话错误
  const exitError = new Promise<never>((_, reject) => {
    child?.once('exit', (code) => {
      reject(
        new Error(
          `内置模型程序启动失败就退出了(退出码 ${code ?? '未知'}):常见原因是程序路径没指对、模型文件损坏,或端口被占用`
        )
      )
    })
    child?.once('error', (err) => {
      const msg =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? '找不到 llama-server 程序:去「AI 设置」重新选一下程序路径'
          : `内置模型程序没法启动:${err.message}`
      reject(new Error(msg))
    })
  })

  const healthUrl = baseUrl.replace(/\/v1$/, '') + '/health'
  const ready = (async () => {
    const deadline = Date.now() + READY_TIMEOUT_MS
    let healthy = false
    while (Date.now() < deadline) {
      if (!isBuiltinRunning()) break // 进程已退出,交给 exitError 报错
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
        if (res.ok) {
          healthy = true
          break // 200 = 模型加载完毕
        }
        // 503 = 还在加载,继续等
      } catch {
        // 还没开始监听端口,继续等
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    if (!isBuiltinRunning()) throw new Error('内置模型进程提前退出了,检查路径和模型文件')
    if (!healthy) {
      throw new Error('模型加载超时(等了两分钟还没就绪):模型可能太大,换个小点的模型,或关掉其他吃内存的程序再试')
    }

    // 就绪后问它加载了哪个模型;刚就绪就断线的话给人话兜底
    let model: string
    try {
      model = await fetchModelId(baseUrl)
    } catch (err) {
      throw err instanceof Error && err.message.includes('内置模型')
        ? err
        : new Error('内置模型刚就绪就没了响应,再点一次试试')
    }
    return { baseUrl, model }
  })()

  // 谁先出结果听谁的:就绪 or 进程夭折
  return Promise.race([ready, exitError])
}

/** 杀掉内置模型子进程。幂等:没在跑就直接返回。app 退出时调用。 */
export function stopBuiltinServer(): void {
  if (child && child.exitCode === null) {
    child.kill()
  }
  child = null
  readyPromise = null
  startedKey = ''
}
