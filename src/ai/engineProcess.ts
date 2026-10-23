// 引擎进程的收尸账:端口监听者、PID 档、孤儿清理。
// 病根(2026-09-18 全机卡死案):只认「正在监听 8766」的进程;可引擎加载的那几秒还没开始
// listen —— 死在加载阶段的孤儿永远收不到尸,白占十几 GB 显存内存,下次再拉一份就是双倍账单。
// 治法:spawn 成功就把 child.pid 落盘(userData/engine-running.json);引擎一退就删档。
// app 被强杀时档和引擎一起留下 —— 下次启动照档检查:PID 活着且映像名是
// llama-server.exe 才收;不在或被别的程序复用只清档不动手,绝不误杀。
import { existsSync, rmSync } from 'node:fs'
import { readJsonFile, writeJsonFile } from '../shared/jsonFile.ts'
import { addDevLog } from '../shared/devlog.ts'
import { BUILTIN_PORT } from './builtinLaunch.ts'
import { builtinDataFile } from './builtinDataDir.ts'
import { runCommand } from './procCommand.ts'

/** 引擎进程名(收尸时先验明正身,绝不误杀别的程序) */
export const ENGINE_IMAGE = 'llama-server.exe'

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
export async function findListenerPids(): Promise<number[]> {
  try {
    const out = await runCommand('netstat', ['-ano', '-p', 'tcp'])
    return parseListenerPids(out, BUILTIN_PORT)
  } catch {
    return []
  }
}

export async function tasklistImage(pid: number): Promise<string> {
  try {
    const out = await runCommand('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
    return parseTasklistImage(out)
  } catch {
    return ''
  }
}

function enginePidPath(): string | null {
  return builtinDataFile('engine-running.json')
}

/** PID 档认读(纯函数,自测覆盖):只认正整数 pid,变形/垃圾回 null */
export function parseEnginePidFile(raw: unknown): number | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const pid = (raw as Record<string, unknown>)['pid']
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null
}

export function writeEnginePidFile(pid: number): void {
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
export function clearEnginePidFileFor(pid: number | undefined): void {
  const file = enginePidPath()
  if (!file || pid === undefined || !existsSync(file)) return
  if (parseEnginePidFile(readJsonFile(file)) === pid) removePidFile(file)
}

/** 照 PID 档检查:上次拉起没收场的引擎(含死在加载中没 listen 的) */
async function inspectOrphanByPidFile(): Promise<boolean> {
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
export async function reapEngineOrphans(): Promise<OrphanReapResult> {
  if (process.platform !== 'win32') return { killed: false }
  await inspectOrphanByPidFile()
  // 强杀后端口释放要一两秒,等它真放开再交差
  return inspectBuiltinConflict({ listeners: findListenerPids, image: tasklistImage })
}
