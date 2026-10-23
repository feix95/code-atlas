// 翻文件模式的人设装配与拆卸:垫「有什么手脚」的切片,联网开着再垫上网守则;
// 引擎不认工具调用时拆掉手脚切片、换成「没手脚」的实话,别让它空口吹翻过项目。
import type { AgentChatMessage } from '../ai/agent.ts'
import { AGENT_WEB_ADDENDUM } from '../ai/agent.ts'
import { AGENT_FILES_ADDENDUM, SLICE_NO_TOOLS } from '../ai/prompts.ts'
import { flattenToolMessages } from '../ai/chatThread.ts'

/** 本轮要垫在人设后面的切片:翻文件守则 (+ 联网守则);旧守则自带开头换行,这里补上 */
export function buildAgentAddendum(webSearchEnabled: boolean): string {
  return `\n\n${AGENT_FILES_ADDENDUM}${webSearchEnabled ? AGENT_WEB_ADDENDUM : ''}`
}

/** 把对话里的工具往来拍平成普通问答(引擎不认工具调用时的退路) */
export function flattenAgentMessages(messages: AgentChatMessage[]): void {
  messages.splice(0, messages.length, ...flattenToolMessages(messages))
}

/** 起手人设:正常引擎垫守则,黑名单引擎垫「没手脚」的实话 */
export function applyAgentPersona(
  messages: AgentChatMessage[],
  opts: { addendum: string; engineNoTools: boolean }
): void {
  const systemIdx = messages.findIndex((m) => m.role === 'system')
  if (systemIdx < 0) return
  const sysContent = (messages[systemIdx] as { content: string }).content
  // 黑名单引擎也得给句准话:agent 底座(buildChatSystem({agent:true}))里没有「没手脚」切片,
  // 什么都不垫,模型会照旧吹自己翻过项目 —— 改垫无工具切片,明说本轮没有翻文件能力
  messages[systemIdx] = {
    role: 'system',
    content: opts.engineNoTools
      ? `${sysContent}\n\n${SLICE_NO_TOOLS}`
      : `${sysContent}${opts.addendum}`
  }
}

/** 摔了「不认工具调用」的跤之后:拆掉守则切片,补一句「没手脚」的实话 */
export function dropAgentToolsPersona(messages: AgentChatMessage[], addendum: string): void {
  const sysIdx = messages.findIndex((m) => m.role === 'system')
  if (sysIdx < 0) return
  let sysContent = (messages[sysIdx] as { content: string }).content
  if (sysContent.endsWith(addendum)) sysContent = sysContent.slice(0, -addendum.length)
  // 切片摘走后,人设里什么能力声明都没剩 —— 补一段「没手脚」切片,别让它空口吹翻过项目。
  // includes 保险:起手黑名单分支理论上和这里互斥,但万一已经垫过就不重复加
  if (!sysContent.includes(SLICE_NO_TOOLS)) sysContent = `${sysContent}\n\n${SLICE_NO_TOOLS}`
  messages[sysIdx] = { role: 'system', content: sysContent }
}

/** 拔掉对话里的提醒卡(个别引擎不认「tool 结果后面跟 user 消息」的形态) */
export function stripAgentReminders(
  messages: AgentChatMessage[],
  prefix: string
): AgentChatMessage[] {
  return messages.filter(
    (m) => !(m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(prefix))
  )
}
