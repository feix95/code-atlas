// 翻文件模式(agent)的纯逻辑库房(第一百二十八锤)。
// 这里只放「算得出来」的东西:工具表、路径安检、读文件额度、防打转的缰绳、
// 单轮请求的收发。真正动手翻文件系统的那只手在主进程(main/index.ts 的
// agentListFiles / agentReadFile),那边有 fs;这边一个 node:fs 都不碰,
// 自测脚本拖进来秒跑。
//
// 三条沙盒铁律(开工前跟小葵聊定的):
// 1. 只发「看」的工具(列名单/读文件),没有「改」的 —— 想作恶连入口都没有
// 2. 路径一律走项目内的相对路径,主进程拼绝对路径前还有 joinRoot 二道岗
// 3. 缰绳:轮数封顶 + 同一样东西不许翻第二遍,防止小模型原地转圈烧锅
import type { AiStreamStats, AiUsage, ChatTarget } from '../shared/types.ts'
import { friendlyHttpError, splitThinking, sseEvents, type ToolCallDelta } from './index.ts'

/** 工具轮数封顶:8 轮翻不满就逼它交卷(再多的部分下一问继续) */
export const AGENT_MAX_ROUNDS = 8

/** list_files 名单条数封顶:名字虽便宜,C 盘级别的目录也不能真全列 */
export const AGENT_LIST_MAX_ENTRIES = 400

/** search_content 的缰绳:最多扫 2000 个文本文件、最多报 50 条命中,别让一个关键词把机器烧干 */
export const AGENT_SEARCH_MAX_FILES = 2000
export const AGENT_SEARCH_MAX_MATCHES = 50

/** 目录下钻深度上限:和扫描器一个思路,超深目录不陪它玩 */
export const AGENT_MAX_DEPTH = 12

/** read_file 拒收的体积上限:再大的文件就该让用户挑一段引用,别整读 */
export const AGENT_FILE_MAX_BYTES = 5 * 1024 * 1024

/**
 * 单次读文件的字数额度,看锅下菜:锅小少读点,锅大放宽到 12000 字。
 * 16384 的锅 → 5461 字;8192 → 2731(触底保护前);4096 → 2000(触底);32768 往上 → 12000(封顶)。
 * 第一百三十七锤放宽了一档(原 8000/除四):锅快满有自动压缩接着(同一锤),
 * 读可以大胆些 —— 一次读全,好过读半截再花一轮补读。
 */
export function agentReadChars(contextTokens: number): number {
  return Math.min(12000, Math.max(2000, Math.floor(contextTokens / 3)))
}

/** 账面换算:约几个字算一个 token。代码偏 4 字一个,中文偏 2 字一个,取 3 打粗账 */
export const AGENT_CHARS_PER_TOKEN = 3

/** 压缩时留原样的最近工具结果条数:最新的资料模型正要用,绝不压 */
export const AGENT_KEEP_RECENT_TOOLS = 2

/** 工具结果压成占位纸条的门槛:比这短的字数压了也省不出几个 token,不值得动 */
export const AGENT_STUB_MIN_CHARS = 300

/** 占位纸条保留原文开头的字数:留个开头,模型还记得这段大概是什么 */
export const AGENT_STUB_HEAD_CHARS = 200

/**
 * 对话账面估算(纯函数,自测覆盖):所有消息按字数折成约多少 token。
 * assistant 的工具调用参数也是账面的一部分(arguments 可能是很长的 JSON)。
 */
export function estimateMessagesTokens(messages: AgentChatMessage[]): number {
  let chars = 0
  for (const message of messages) {
    chars += (typeof message.content === 'string' ? message.content : '').length
    if ('tool_calls' in message && message.tool_calls) {
      for (const call of message.tool_calls) {
        chars += call.function.name.length + call.function.arguments.length + 16
      }
    }
  }
  return Math.ceil(chars / AGENT_CHARS_PER_TOKEN)
}

/**
 * 提示词侧的预算(纯函数,自测覆盖):锅减去留给答案的空间(replyCap,思考另算的
 * 也含在调用方传进来的数里),再打八折当警戒线 —— 账面超过它就压缩。
 * 算出来再小也不低于 2048:锅再小,压到没东西可读还不如让引擎自己喊挤。
 */
export function agentPromptBudget(ctx: number, replyCap: number): number {
  const usable = Math.max(2048, ctx - Math.max(1024, replyCap))
  return Math.max(2048, Math.floor(usable * 0.8))
}

/** 压缩的结果:换好的新对话 + 被压掉的工具结果 id(主进程据此解锁「不许翻第二遍」) */
export interface AgentCompression {
  messages: AgentChatMessage[]
  freedCallIds: string[]
  compressedCount: number
}

/**
 * 上下文自动压缩(纯函数,自测覆盖,第一百三十七锤):账面超过预算时,把较早的
 * 工具结果(翻文件读进来的大段原文)换成占位纸条,最近 2 条留原样。
 * 只动 tool 消息 —— 人设、用户的提问、assistant 的喊话都不碰;协议要求
 * tool 结果和 assistant 的 tool_calls 成对,只缩内容不动条数,对账关系不破。
 * 不超预算返回 null(啥也不用做);原数组不动,压不压、压多少都由调用方拍板。
 */
export function compressAgentMessages(messages: AgentChatMessage[], budgetTokens: number): AgentCompression | null {
  if (estimateMessagesTokens(messages) <= budgetTokens) return null
  const toolIdx: number[] = []
  for (const [index, message] of messages.entries()) {
    if (message.role === 'tool') toolIdx.push(index)
  }
  // 倒数第 1、2 条留原样,更早的长条目压成纸条
  const keepFrom = Math.max(0, toolIdx.length - AGENT_KEEP_RECENT_TOOLS)
  const freedCallIds: string[] = []
  let compressedCount = 0
  const next = messages.map((message, index) => {
    if (message.role !== 'tool' || !toolIdx.includes(index) || toolIdx.indexOf(index) >= keepFrom) return message
    if (message.content.length <= AGENT_STUB_MIN_CHARS) return message
    compressedCount += 1
    freedCallIds.push(message.tool_call_id)
    const head = message.content.slice(0, AGENT_STUB_HEAD_CHARS).replaceAll('\n', ' ')
    return {
      role: 'tool' as const,
      tool_call_id: message.tool_call_id,
      content: `${head}……(这条是早先翻看的资料,对话锅快满了,已提炼成占位纸条;原文约 ${message.content.length} 字。要重温就再调一次工具重读,允许重读)`
    }
  })
  if (compressedCount === 0) return null
  return { messages: next, freedCallIds, compressedCount }
}

/**
 * 模型递回来的路径安检(纯函数,自测覆盖):只收项目内相对路径。
 * 反斜杠统一成正斜杠;盘符、绝对路径、含 .. 上跳的一律拒收(返回 null)。
 * 真正拼绝对路径时主进程还有 joinRoot 把第二道关,这里是给模型的第一次提醒。
 */
export function sanitizeAgentRelPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().replaceAll('\\', '/')
  if (cleaned === '') return ''
  if (/^[a-zA-Z]:/.test(cleaned)) return null // 盘符注入(C:\...)
  if (cleaned.startsWith('/')) return null // 绝对路径
  const parts = cleaned.split('/')
  for (const part of parts) {
    if (part === '..') return null // 上跳越界
  }
  return parts.filter((p) => p !== '.').join('/')
}

/** OpenAI tools 格式的工具表:只有「看」的三件,写文件的工具根本不存在 */
export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        '列出项目里某个文件夹下的全部文件和子文件夹名字(递归,含子文件夹内部)。想知道「项目里有没有 xx 文件」「src 下都有什么」就用它。路径一律用相对路径,项目根目录传空字符串。',
      parameters: {
        type: 'object',
        properties: {
          relPath: { type: 'string', description: '文件夹的相对路径,如 src/utils;项目根目录传空字符串' }
        },
        required: ['relPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        '读项目里某个文本文件的内容(超长只读开头一段,会注明)。想看某个文件具体写了什么就用它。路径一律用相对路径。',
      parameters: {
        type: 'object',
        properties: {
          relPath: { type: 'string', description: '文件的相对路径,如 src/index.ts' }
        },
        required: ['relPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description:
        '在整个项目(或某个文件夹)里按关键词搜文件内容,返回命中的文件、行号和那一行原文。想找「某个词/某个数值/某段代码写在哪个文件里」就用它,比一个个开文件快得多。关键词要短而准(函数名、常量值这类),太长的整句容易一处都搜不到。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '要搜的关键词,越短越准,如 DWELL_MS 或 500' },
          relPath: {
            type: 'string',
            description: '可选:只搜这个文件夹下面,如 src/renderer;不传或传空字符串就搜整个项目'
          }
        },
        required: ['keyword']
      }
    }
  }
] as const

/** 加在自由聊天人设后面的翻文件守则:教模型何时动手、何时报答案 */
export const AGENT_ADDENDUM = `

【翻文件模式】你现在可以自己翻这个项目的文件:
- 需要找文件、看目录结构时,用 list_files 列名单
- 需要找「某个词/数值/代码写在哪个文件」时,用 search_content 按关键词搜内容,又快又准
- 需要看某个文件的具体内容时,用 read_file 读它
- 路径一律用项目内的相对路径;当前参考资料里提到的路径可以直接用
- 规矩:同一样东西不翻第二遍;翻几次能答的就别翻个没完;资料够了就直接回答,
  回答时像平常一样说人话,不要提「工具」「函数」这些词,就说你翻了翻项目
- 翻看记录太多时,较早的会提炼成占位纸条(写着原文约多少字);纸条只是提词,
  要重温原文就再调一次工具重读,这种重读不算翻第二遍`
/** 同一样东西翻第二遍时,当工具结果喂回去的提醒(缰绳之一) */
export const REPEAT_NUDGE =
  '这个你刚才已经看过了,名单和内容都没变 —— 别再翻,直接用已经看到的资料继续干活或回答。'

/** 工具轮数烧完后的逼卷令:当一条普通消息插进对话,模型只能交答案 */
export const ROUND_CAP_NUDGE =
  '(翻看步数已到上限)别再调用任何工具了,就用现在已经看到的资料,直接把答案完整说完。'

/** 模型喊的工具调用,洗成统一形状:参数解析失败不炸循环,当空参处理 */
export interface AgentToolCall {
  id: string
  name: string
  /** 解析好的参数(arguments 是坏 JSON 时为 null,让主进程走「参数不合法」的喂回) */
  args: Record<string, unknown> | null
  /** 原样的 arguments 字符串:回填 assistant 消息时要原样还给服务端 */
  rawArguments: string
}

/** 服务端回信里的 assistant 消息原样结构(回填对话时要原样还回去) */
export interface AgentRawAssistant {
  role: 'assistant'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/** agent 循环里的一条对话消息(比普通聊天多了 tool 两种形态) */
export type AgentChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | AgentRawAssistant
  | { role: 'tool'; tool_call_id: string; content: string }

/** arguments 字段洗成对象(纯函数,自测覆盖):字符串 JSON / 直接对象都收,坏的重伤不治给 null */
export function parseToolArgs(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>
  return null
}

/** 把服务端回信里的 tool_calls 洗成统一形状(缺 id 的补个序号,免得对不上账) */
export function extractToolCalls(raw: AgentRawAssistant): AgentToolCall[] {
  const calls = raw.tool_calls ?? []
  return calls.map((call, index) => ({
    id: typeof call.id === 'string' && call.id !== '' ? call.id : `call_${index}`,
    name: typeof call.function?.name === 'string' ? call.function.name : '',
    args: parseToolArgs(call.function?.arguments),
    rawArguments: typeof call.function?.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function?.arguments ?? {})
  }))
}

/** 防打转的记账键:工具名 + 目标路径,唯一标识「翻过这样东西」 */
export function toolCallKey(name: string, relPath: string): string {
  return `${name}:${relPath}`
}

/** 每个工具步骤给界面垫的一句大白话(纯函数,自测覆盖):翻什么、看成没看成,一眼明白 */
export function agentStepText(
  tool: 'list_files' | 'read_file' | 'search_content',
  target: string,
  state: 'done' | 'repeat' | 'error',
  hint?: string
): string {
  const what = tool === 'list_files' ? '的文件名单' : tool === 'read_file' ? '的内容' : ''
  const verb = tool === 'list_files' ? '翻了' : tool === 'read_file' ? '读了' : '搜了'
  if (state === 'repeat') return `「${target}」刚才已经看过了,不用再翻`
  if (state === 'error') return `「${target}」看不了${hint ? `:${hint}` : ''}`
  return `${verb}「${target}」${what}${hint ? `(${hint})` : ''}`
}

/** 多轮的 token 账并成一本总账(纯函数,自测覆盖):读写累加,速度认最后一轮的 */
export function mergeUsage(a: AiUsage | undefined, b: AiUsage | undefined): AiUsage | undefined {
  if (!a) return b
  if (!b) return a
  return {
    promptTokens: (a.promptTokens ?? 0) + (b.promptTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    tokensPerSecond: b.tokensPerSecond ?? a.tokensPerSecond
  }
}

/** agent 单轮请求的结果:要么拿到模型消息(可能带工具调用),要么带人话错误退场 */
export type AgentRoundResult =
  | { status: 'ok'; raw: AgentRawAssistant; reasoning?: string; usage?: AiUsage }
  | { status: 'error' | 'cancelled'; text: string }

/** 流式轮次边收边推给界面的事件(第一百三十四锤):增量 + token 账 + 回滚令 */
export interface AgentStreamEvent {
  text?: string
  reasoning?: string
  stats?: AiStreamStats
  /** 中间轮次预吐的字被证明不是答案(模型喊了工具),让界面把已吐的字收回去 */
  reset?: boolean
}

/**
 * 把流式一帧帧的工具调用碎片拼成完整的调用表(纯函数,自测覆盖)。
 * OpenAI 方言:参数按 index 分组,arguments 是逐段续的字符串,名字和 id 只在首帧出现;
 * 缺 index 的(个别服务)当第 0 个,缺 id 的补序号 —— 和非流式的 extractToolCalls 同一套兜底。
 */
export function assembleToolCalls(chunks: ToolCallDelta[]): AgentToolCall[] {
  const slots = new Map<number, { id?: string; name?: string; args: string }>()
  for (const chunk of chunks) {
    const index = typeof chunk.index === 'number' && Number.isFinite(chunk.index) ? chunk.index : 0
    const slot = slots.get(index) ?? { args: '' }
    if (slot.id === undefined && typeof chunk.id === 'string' && chunk.id !== '') slot.id = chunk.id
    if (slot.name === undefined && typeof chunk.function?.name === 'string' && chunk.function.name !== '') {
      slot.name = chunk.function.name
    }
    if (typeof chunk.function?.arguments === 'string') slot.args += chunk.function.arguments
    slots.set(index, slot)
  }
  return [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, slot]) => ({
      id: slot.id ?? `call_${index}`,
      name: slot.name ?? '',
      args: slot.args === '' ? null : parseToolArgs(slot.args),
      rawArguments: slot.args
    }))
}

/** 等响应头的耐心(和普通聊天同一口径:大提示词预处理可能整段静默;首帧之后由 sseEvents 自己的看门狗接管) */
const HEADERS_TIMEOUT_MS = 120_000

/**
 * agent 的单轮请求(流式,第一百三十四锤):带上工具表问模型,边收边拼边推。
 * 思考和正文逐帧走 onDelta 推给界面(左下角的 token 账同帧捎走),等答案不再是黑洞;
 * 工具调用的参数碎片按 index 现场拼(assembleToolCalls)。
 * useTools = false 时(轮数烧完的逼卷轮)不带工具表,模型只能交答案。
 * 中间轮次预吐的正文若被证明不是答案(模型喊了工具),先发 reset 令让界面收回去。
 */
export async function agentRound(
  config: ChatTarget,
  messages: AgentChatMessage[],
  opts: { signal?: AbortSignal; maxTokens: number; allowThinking?: boolean; useTools: boolean; onDelta?: (ev: AgentStreamEvent) => void }
): Promise<AgentRoundResult> {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const controller = new AbortController()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  let watchdog: ReturnType<typeof setTimeout> | undefined
  try {
    watchdog = setTimeout(() => controller.abort(), HEADERS_TIMEOUT_MS)
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: opts.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.useTools ? { tools: AGENT_TOOLS, tool_choice: 'auto' } : {}),
        // 和普通聊天同一口径:思考开关只对内置引擎发(外接服务不认这个字段)
        ...(!opts.allowThinking && config.timings ? { chat_template_kwargs: { enable_thinking: false } } : {})
      }),
      signal: controller.signal
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const friendly = friendlyHttpError(res.status, detail)
      return {
        status: 'error',
        text: friendly ?? `模型服务返回错误(${res.status})${detail ? `:${detail.slice(0, 120)}` : ''}`
      }
    }
    // 响应头到手,首帧后的耐心交给 sseEvents 自己的看门狗
    clearTimeout(watchdog)
    let content = ''
    let reasoning = ''
    const fragments: ToolCallDelta[] = []
    let lastStats: AiStreamStats | undefined
    for await (const ev of sseEvents(res, controller.signal)) {
      if (ev.text) content += ev.text
      if (ev.reasoning) reasoning += ev.reasoning
      if (ev.toolCalls) fragments.push(...ev.toolCalls)
      if (ev.stats) lastStats = ev.stats
      if (opts.onDelta && (ev.text || ev.reasoning || ev.stats)) {
        opts.onDelta({ text: ev.text, reasoning: ev.reasoning, stats: ev.stats })
      }
    }
    const usage: AiUsage | undefined = lastStats
      ? { promptTokens: lastStats.promptTokens, outputTokens: lastStats.outputTokens, tokensPerSecond: lastStats.tokensPerSecond }
      : undefined
    // 正文里掺的 <think> 标签拆干净(有的后端把思考掺在正文里):拆出了思考原文,
    // 说明预吐的字不干净,发 reset 令收回去,把干净的答案重讲一遍
    const split = splitThinking(content)
    const answer = split.answer
    if (opts.onDelta && split.reasoning !== '') {
      opts.onDelta({ reset: true })
      if (answer.trim() !== '') opts.onDelta({ text: answer })
    }
    const calls = assembleToolCalls(fragments)
    if (calls.length > 0) {
      // 这轮喊了工具:预吐的正文不是最终答案(有的模型边想边嘀咕),收回,
      // 界面只剩思考块和步骤灰字,等下一轮的正文
      if (opts.onDelta && answer.trim() !== '') opts.onDelta({ reset: true })
      const cleaned: AgentRawAssistant = {
        role: 'assistant',
        content: answer.trim() === '' ? null : answer,
        tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.rawArguments } }))
      }
      return { status: 'ok', raw: cleaned, reasoning: reasoning || split.reasoning || undefined, usage }
    }
    const cleaned: AgentRawAssistant = answer.trim() === '' ? { role: 'assistant', content: null } : { role: 'assistant', content: answer }
    return { status: 'ok', raw: cleaned, reasoning: reasoning || split.reasoning || undefined, usage }
  } catch (err) {
    if (opts.signal?.aborted) return { status: 'cancelled', text: '取消了 —— 这轮没等到输出' }
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    return {
      status: 'error',
      text: isTimeout ? '等了很久模型都没回话,翻看停在这了 —— 再问一次试试' : `连接断了,模型服务可能停了(${baseUrl})`
    }
  } finally {
    clearTimeout(watchdog)
  }
}
