// 后台日志账本(第八十七锤,Developer 日志窗口的库房)。
// 纯模块:不 import electron —— 主进程、AI 模块、自测脚本都从这里进同一本账。
// 只是个环形缓冲,进程退出就清空,不落盘 —— 后台日志是给现场排障用的,不是档案。
import type { DevLogEntry, DevLogSource } from './types.ts'

/** 账本容量:llama-server 加载一个大模型能吐几百行,留 2000 条足够回溯 */
export const DEVLOG_MAX = 2000

/** 单条上限:llama.cpp 的进度条用回车刷屏,一行能拖出去老长,掐头留尾 */
export const DEVLOG_LINE_MAX = 600

/** 单行超长的处理(纯函数,自测覆盖):掐中间留头尾,注明省了多少字 */
export function capDevLogLine(text: string, max = DEVLOG_LINE_MAX): string {
  if (text.length <= max) return text
  const half = Math.floor(max / 2)
  const omitted = text.length - max
  return `${text.slice(0, half)}……(省略 ${omitted} 字)……${text.slice(-half)}`
}

/** 一块引擎输出 → 一条条日志(纯函数,自测覆盖):按回车/换行切,
 * llama.cpp 进度条的 \r 刷新逐帧成行,空行和纯空白不记账 */
export function splitDevLogLines(chunk: string): string[] {
  return chunk
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export interface DevLogRing {
  /** 现在账上有多少条 */
  count(): number
  /** 全部存档,按记账顺序(旧→新);给出去的是拷贝,外面改不动账本 */
  snapshot(): DevLogEntry[]
  /** 记一笔(自动按行拆);每记一条都喊一声监听者 */
  add(source: DevLogSource, text: string): void
  /** 清账 */
  clear(): void
}

/** 造一本环形账(纯工厂,自测覆盖):满 2000 条丢最旧的,编号全局单调不回头 */
export function createDevLogRing(max = DEVLOG_MAX): DevLogRing {
  const entries: DevLogEntry[] = []
  let nextId = 1
  return {
    count: () => entries.length,
    snapshot: () => entries.map((e) => ({ ...e })),
    add(source, text) {
      for (const line of splitDevLogLines(text)) {
        entries.push({ id: nextId++, ts: Date.now(), source, text: capDevLogLine(line) })
        if (entries.length > max) entries.shift()
        onAdd?.(entries[entries.length - 1])
      }
    },
    clear() {
      entries.length = 0
    }
  }
}

/** 新条目监听者:主进程注册广播员,每记一笔就往日志窗口推一条 */
let onAdd: ((entry: DevLogEntry) => void) | null = null

/** 全局一本账:整个 app 就这一份后台日志 */
const theLedger = createDevLogRing()

/** 主进程注册广播员(先前的不再喊);返回注销函数 */
export function setDevLogListener(fn: ((entry: DevLogEntry) => void) | null): () => void {
  onAdd = fn
  return () => {
    if (onAdd === fn) onAdd = null
  }
}

/** 记一笔后台日志(全局账本入口) */
export function addDevLog(source: DevLogSource, text: string): void {
  theLedger.add(source, text)
}

/** 全量拉走(日志窗口打开时先补一遍旧账) */
export function devLogSnapshot(): DevLogEntry[] {
  return theLedger.snapshot()
}

/** 清账 */
export function clearDevLogs(): void {
  theLedger.clear()
}

/** 时间戳 → 挂墙上的钟(纯函数,自测覆盖):HH:MM:SS,日志窗口和人话回放共用 */
export function formatDevLogTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 来源 → 界面标签(纯函数):日志窗口的过滤片和行标共用一份口径 */
export function devLogSourceName(source: DevLogSource): string {
  if (source === 'engine') return '引擎'
  if (source === 'request') return '请求'
  return '应用'
}
