// 内置模型 Provider:把 llama-server 当独立子进程养起来。
// 它一启动就暴露 OpenAI 兼容的 HTTP API,对上层来说和 LM Studio 没区别 ——
// 都是"一个 baseURL + 一个模型名",业务代码不感知底下是谁在跑。
// 生命周期:首次用到 AI 才启动(不拖慢 app 打包体积和启动速度);app 退出时杀掉。
// 端口固定 8766,避开 LM Studio 默认的 1234。
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AiBuiltinSettings } from '../shared/types.ts'

/** 内置 llama-server 的固定端口(与 LM Studio 默认 1234 错开) */
const BUILTIN_PORT = 8766
/** 就绪等待上限:大模型首次加载要往显存/内存里灌几个 GB,给足耐心 */
const READY_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 1000

/** 当前子进程与它的就绪结果(模块级单例:整个 app 只养一个内置模型) */
let child: ChildProcess | null = null
let readyPromise: Promise<{ baseUrl: string; model: string }> | null = null

export function isBuiltinRunning(): boolean {
  return child !== null && child.exitCode === null
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

/**
 * 确保 llama-server 跑起来了,返回它的 ChatTarget(baseUrl + 模型名)。
 * 已在跑就直接复用;没跑就拉起、轮询 /health 直到就绪、再问 /v1/models 拿模型名。
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

async function startAndWaitReady(serverPath: string, modelPath: string, baseUrl: string): Promise<{ baseUrl: string; model: string }> {
  child = spawn(serverPath, ['-m', modelPath, '--port', String(BUILTIN_PORT), '--host', '127.0.0.1', '-c', '4096', '-ngl', '999'], {
    windowsHide: true,
    stdio: 'ignore'
  })

  // 子进程半路夭折(路径不对、缺 DLL、端口被占)→ 挂起的等待直接收到人话错误
  const exitError = new Promise<never>((_, reject) => {
    child?.once('exit', (code) => {
      reject(new Error(`内置模型程序启动失败就退出了(退出码 ${code ?? '未知'}):检查「AI 设置」里的程序路径是否指到 llama-server 可执行文件`))
    })
    child?.once('error', (err) => {
      const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? '找不到 llama-server 程序:去「AI 设置」重新选一下程序路径'
        : `内置模型程序没法启动:${err.message}`
      reject(new Error(msg))
    })
  })

  const healthUrl = baseUrl.replace(/\/v1$/, '') + '/health'
  const ready = (async () => {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (!isBuiltinRunning()) break // 进程已退出,交给 exitError 报错
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
        if (res.ok) break // 200 = 模型加载完毕
        // 503 = 还在加载,继续等
      } catch {
        // 还没开始监听端口,继续等
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    if (!isBuiltinRunning()) throw new Error('内置模型进程提前退出了,检查路径和模型文件')

    // 就绪后问它加载了哪个模型(llama-server 以模型文件名作为模型 id)
    const modelsRes = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) })
    if (!modelsRes.ok) throw new Error(`内置模型已启动,但拿不到模型信息(${modelsRes.status})`)
    const data = (await modelsRes.json()) as { data?: Array<{ id?: string }> }
    const model = data.data?.[0]?.id
    if (!model) throw new Error('内置模型已启动,但报告不出模型名')
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
}
