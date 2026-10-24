// agent 循环的消息与结果形状(纯类型,没有运行时代码)。
import type { AiStreamStats, AiUsage } from '../shared/types.ts'
import type { ChatContentPart } from '../shared/chatImage.ts'

/** read_file 一次读出的成品:带行号的正文 + 行账;ok:false = offset 跑到文件外面了 */
export interface AgentReadSlice {
  ok: boolean
  text: string
  hint?: string
}

/** 压缩的结果:换好的新对话 + 被压掉的工具结果 id(主进程据此解锁「不许翻第二遍」) */
export interface AgentCompression {
  messages: AgentChatMessage[]
  freedCallIds: string[]
  compressedCount: number
}

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

/** agent 循环里的一条对话消息(比普通聊天多了 tool 两种形态);
 *  user 的 content 可以是多模态分段数组(带图轮);数组形态不跟别的消息合并 */
export type AgentChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string | ChatContentPart[] }
  | AgentRawAssistant
  | { role: 'tool'; tool_call_id: string; content: string }

/** agent 单轮请求的结果:要么拿到模型消息(可能带工具调用),要么带人话错误退场 */
export type AgentRoundResult =
  | { status: 'ok'; raw: AgentRawAssistant; reasoning?: string; usage?: AiUsage }
  | {
      status: 'error'
      text: string
      toolsUnsupported?: boolean
      /** HTTP 状态码(有响应头才有):主进程的提醒卡兜底靠它认 4xx */ httpStatus?: number
    }
  | { status: 'cancelled'; text: string }
  | {
      status: 'repetition'
      /** 犯病那轮的全文(含打转部分):主进程的重答兜底拿它截断交卷 */ text: string
      /** 打转前是否已经吐过正文:吐过就不许整段撤回,只截打转尾巴 */
      bodyStarted?: boolean
    }

/** 流式轮次边收边推给界面的事件:增量 + token 账 + 回滚令 + 封板令 */
export interface AgentStreamEvent {
  text?: string
  reasoning?: string
  stats?: AiStreamStats
  /** 已吐的字是垃圾/脏稿(复读打转、思考标签掺进正文),让界面收回去 */
  reset?: boolean
  /** 本轮吐的字是正经话且模型喊了工具:让界面把当前气泡封口保留,
   *  另起新气泡接下一轮 —— 说出口的话不抹掉,各轮的输出和思考按轮分开 */
  seal?: boolean
}
