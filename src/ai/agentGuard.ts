// agent 的提醒话术与提醒卡:重复翻同一东西的提醒、轮数烧完的逼卷令、
// 每轮工具结果后把真问题重新钉在模型眼前。全是纯函数 + 常量,不动会话状态。
import { TAG } from '../shared/promptTags.ts'
import type { AgentChatMessage } from './agentTypes.ts'

/** 同一样东西翻第二遍时,当工具结果喂回去的提醒(护栏之一;主进程外层再包 tool_result) */
export const REPEAT_NUDGE = `${TAG.programNote.open}这个你刚才已经看过了,名单和内容都没变 —— 别再翻,直接用已经看到的资料继续干活或回答。${TAG.programNote.close}`

/** 工具轮数烧完后的逼卷令:当一条普通消息插进对话,模型只能交答案 */
export const ROUND_CAP_NUDGE = `${TAG.programReminder.open}\n翻看步数已到上限 —— 别再调用任何工具了,就用现在已经看到的资料,直接把答案完整说完。\n${TAG.programReminder.close}`

/** 联网研究预算:搜索与打开网页合计最多几次(产品定 8 次,防止无限搜) */
export const AGENT_WEB_MAX_LOOKUPS = 8

/** 联网预算用满后的收尾令:工具表里已经撤掉联网件,这轮只能用手头资料 */
export const WEB_BUDGET_NUDGE = `${TAG.programReminder.open}\n联网研究已用满 ${AGENT_WEB_MAX_LOOKUPS} 次,现在不再提供 web_search / web_fetch。用已经搜到的资料和网页节选把答案收尾;资料不够就如实说明哪部分没查到,不要假装看过。\n${TAG.programReminder.close}`

/** 提醒卡的触发门槛:本场工具调用满这么多次才开始垫提醒卡 ——
 *  前两三轮资料还少,提醒卡只会稀释注意力,不垫 */
export const AGENT_REMINDER_MIN_TOOL_CALLS = 3

/** 提醒卡的内容前缀:撤旧卡、兜底识别都靠它认(别在别处拼这个前缀) */
export const AGENT_REMINDER_PREFIX = `${TAG.programReminder.open}\n本轮要回答的问题:`

/** 联网研究账本的前缀:只挂一张,替换/兜底识别都靠它认 */
export const AGENT_RESEARCH_PREFIX = `${TAG.programReminder.open}\n本轮联网研究账本:`

/** 提醒卡引用问题原话的字数封顶:注记太长自己就成了新的大坨,把注意力又冲散了 */
export const AGENT_REMINDER_MAX_CHARS = 200

/**
 * 本轮问题的提醒卡(纯函数,自测覆盖):agent 每轮工具结果后垫一条 user 消息,
 * 把用户真正的问题重新钉在模型眼皮底下 —— 小模型的注意力被大坨工具结果一冲就散,
 * 真问题容易被挤出视线,靠它每轮抬头见正事。问题原话封顶 200 字。
 */
export function buildAgentReminder(question: string): string {
  const q = question.trim()
  const clipped =
    q.length > AGENT_REMINDER_MAX_CHARS ? `${q.slice(0, AGENT_REMINDER_MAX_CHARS)}……` : q
  return `${AGENT_REMINDER_PREFIX}${clipped}\n上面翻到的都只是资料,接着回答这个问题;资料够答了就别再翻,直接收尾。\n${TAG.programReminder.close}`
}

/**
 * 这一轮要不要走翻文件循环:开关开着、没带图、且有项目沙盒。
 * 没开项目不报错 —— 开关只表示给过这能力,没有文件可翻就当普通对话。
 */
export function agentOnThisRound(input: {
  agent: boolean
  imageCount: number
  rootPath: unknown
}): boolean {
  if (!input.agent) return false
  if (input.imageCount > 0) return false
  return typeof input.rootPath === 'string' && input.rootPath.trim() !== ''
}

/**
 * 撤掉对话里最近一张提醒卡(纯函数,自测覆盖):垫新卡前调用,对话里永远只挂
 * 最新一张 —— 每轮都垫的话八轮攒八张,账面白白涨还稀释注意力。没卡就原样返回。
 */
export function stripLastAgentReminder(messages: AgentChatMessage[]): AgentChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (
      m.role === 'user' &&
      typeof m.content === 'string' &&
      m.content.startsWith(AGENT_REMINDER_PREFIX)
    ) {
      return [...messages.slice(0, i), ...messages.slice(i + 1)]
    }
  }
  return messages
}
