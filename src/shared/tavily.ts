// Tavily Key 的纯规矩(2026-09-17):洗干净、看形状、认状态码 —— 界面/主进程/自测共用这一份,
// 免得三处各写各的。这里不碰网络;真打接口的「测一下」在 ai/weblookup.ts(传输层可注入,自测好测)。
// 为什么不硬拦:Key 的形状是 Tavily 说了算,不是我们 —— 将来它改格式、或者用户走中转服务,
// 硬拦就把人挡门外了。所以这里只出「事实判断」,拦不拦交给界面用黄字提示表达。

/** Tavily 官方 Key 的前缀(官方文档的示例写法:tvly-YOUR_API_KEY) */
export const TAVILY_KEY_PREFIX = 'tvly-'

/**
 * 洗 Key(纯函数,自测覆盖):把复制粘贴常见的污染剥干净 —— 两头成对的引号、
 * `Bearer ` 前缀、夹在中间的空白和换行。洗完是空串 → undefined(存档里不出现这个字段)。
 */
export function sanitizeTavilyKey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  let s = raw.trim()
  // 两头成对的引号:粘自文档、聊天记录、curl 命令时最常见的两兄弟
  const quoted: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’']
  ]
  for (const [open, close] of quoted) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      s = s.slice(1, -1).trim()
      break
    }
  }
  const v = s.replace(/^bearer\s+/i, '').replace(/\s+/g, '')
  return v === '' ? undefined : v
}

/** 形状判断(纯函数,自测覆盖):只回答「像不像 Tavily 的 Key」,不回答「能不能用」—— 能不能用问「测一下」 */
export function looksLikeTavilyKey(key: string): boolean {
  return /^tvly-[A-Za-z0-9_-]{6,}$/.test(key)
}

/** 「测一下」的战果:一个结论 + 网络层给的状态码(压根没连上时没有) */
export type TavilyProbeVerdict = 'ok' | 'bad-key' | 'quota' | 'busy' | 'server' | 'other' | 'unreachable'

export interface TavilyProbeResult {
  verdict: TavilyProbeVerdict
  /** Tavily 或网络层给的原样状态码:界面按需展示,自测按它断言 */
  status?: number
}

/**
 * 状态码 → 结论(纯函数,自测覆盖):照 Tavily 官方文档的分档 ——
 * 401 说「Key 错或没给」;432/433 是额度/账单限额用完(Key 本身没错);429 请求太频繁;
 * 5xx 是它自己出问题。连都没连上(超时/断网/DNS 不通)走 unreachable,那不是 Key 的锅。
 */
export function tavilyVerdictFromStatus(status: number): TavilyProbeVerdict {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401) return 'bad-key'
  if (status === 432 || status === 433) return 'quota'
  if (status === 429) return 'busy'
  if (status >= 500) return 'server'
  return 'other'
}
