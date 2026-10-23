// agent 的工具表与调用参数清洗:本地只有「看」的四件 + 可选的联网件。
import { TOOL_NAMES, TOOL_STEP_WORDS, type ToolName } from '../shared/agentTools.ts'
import type { ToolCallDelta } from './index.ts'
import type { AgentRawAssistant, AgentToolCall } from './agentTypes.ts'

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

/** OpenAI tools 格式的本地工具表:只有「看」的四件,写文件的工具根本不存在 */
export const AGENT_TOOLS_LOCAL = [
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.listFiles,
      description: '递归列目录。',
      parameters: {
        type: 'object',
        properties: {
          relPath: { type: 'string', description: '根内相对路径;根传空串' },
          rootId: { type: 'string' }
        },
        required: ['relPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.readFile,
      description: '读取文本文件,每行带行号;很长时用 offset/limit 分段读。',
      parameters: {
        type: 'object',
        properties: {
          relPath: { type: 'string', description: '根内文件路径' },
          offset: { type: 'integer', description: '第几行开始读(1 起)' },
          limit: { type: 'integer', description: '最多读几行(默认 2000)' },
          rootId: { type: 'string' }
        },
        required: ['relPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.searchContent,
      description: '按短关键词搜索,文件路径和文件内容都算;长句搜不到。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '短关键词' },
          relPath: { type: 'string', description: '根内目录;不传搜整根' },
          rootId: { type: 'string' }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.requestDirectoryAccess,
      description: '申请项目外目录的本次只读权限。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '用户点名的绝对目录' }
        },
        required: ['path']
      }
    }
  }
] as const

/**
 * 联网件 web_search:模型自己上网查公开资料。源队列(Tavily 有 Key 打头 → DDG → 维基)
 * 和三道闸都在 weblookup.ts;它进不进工具表,由「联网查证」开关说了算(agentRound 的 opts)。
 */
export const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.webSearch,
    description: '联网搜索公开资料;不得发送本地路径或文件内容。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '公开搜索词' }
      },
      required: ['query']
    }
  }
} as const

/**
 * 联网件 web_fetch:打开一个已有的公开地址看正文。GitHub blob 由执行手改成 raw,
 * 内网闸与 web_search 同一把。进不进工具表同样由「联网查证」开关说了算。
 */
export const WEB_FETCH_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.webFetch,
    description: '打开公开网页看正文节选;只传 http(s) 地址,不传本地路径。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '公开 http(s) 地址' }
      },
      required: ['url']
    }
  }
} as const

/**
 * 联网件 save_research_note:模型读完一页后,把 1-3 条关键事实记进研究账本。
 * 程序也会自动记账,这个工具让模型主动压缩信息,原文被挤掉后仍有据可依。
 */
export const SAVE_RESEARCH_NOTE_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.researchNote,
    description: '把 1-3 条关键事实记进本轮研究账本;只记对回答问题有用的结论,别抄整段。',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: '一条关键事实(一句话)' },
        source: { type: 'string', description: '可选:来源标题或网址' }
      },
      required: ['note']
    }
  }
} as const

/** 全量工具表(联网查证开着):本地四件 + web_search + web_fetch + save_research_note */
export const AGENT_TOOLS = [
  ...AGENT_TOOLS_LOCAL,
  WEB_SEARCH_TOOL,
  WEB_FETCH_TOOL,
  SAVE_RESEARCH_NOTE_TOOL
]

/** arguments 字段洗成对象(纯函数,自测覆盖):字符串 JSON / 直接对象都收,坏的重伤不治给 null */
export function parseToolArgs(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null
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
    rawArguments:
      typeof call.function?.arguments === 'string'
        ? call.function.arguments
        : JSON.stringify(call.function?.arguments ?? {})
  }))
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
    if (
      slot.name === undefined &&
      typeof chunk.function?.name === 'string' &&
      chunk.function.name !== ''
    ) {
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

/** 防打转的记账键:工具名 + 目标路径,唯一标识「翻过这样东西」 */
export function toolCallKey(name: string, relPath: string): string {
  return `${name}:${relPath}`
}

/** 每个工具步骤给界面垫的一句大白话(纯函数,自测覆盖):翻什么/查什么、看成没看成,一眼明白 */
export function agentStepText(
  tool: ToolName,
  target: string,
  state: 'done' | 'repeat' | 'error',
  hint?: string
): string {
  const w = TOOL_STEP_WORDS[tool]
  if (state === 'repeat') return `「${target}」${w.repeat}`
  if (state === 'error') return `「${target}」${w.error}${hint ? `:${hint}` : ''}`
  return `${w.verb}「${target}」${w.what}${hint ? `(${hint})` : ''}`
}
