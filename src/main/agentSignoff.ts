// 交卷前的质检闸:找位置题不许一次没搜就交,答案得落到具体文件;联网题不许只搜一轮
// 就说没查到。拦下只给「补一句提醒」的裁决,对话改写与计数归调用方。
import {
  AGENT_MAX_ROUNDS,
  SALVAGE_CITE_NUDGE,
  SALVAGE_NUDGE_MAX,
  SALVAGE_SEARCH_NUDGE,
  WEB_SALVAGE_NUDGE,
  WEB_SALVAGE_NUDGE_MAX,
  findAnswerGap,
  findWebAnswerGap,
  isFindQuestion
} from '../ai/agent.ts'

export interface AgentAnswerReviewInput {
  /** 交卷的答案全文 */
  answer: string
  /** 本轮用户真正的问题(已剥掉注意力锚) */
  question: string
  useTools: boolean
  /** 本场真执行成功的工具调用次数(0 = 一口答出来的题,质检闸不伺候) */
  toolCallsExecuted: number
  /** 本场搜过文件没有、搜到的文件路径 */
  searchUsed: boolean
  hitPaths: string[]
  /** 本场联网搜索过几轮、结果标题/链接 */
  webSearchCalls: number
  webTitles: string[]
  webUrls: string[]
  /** 已经拦过几次 */
  salvageNudges: number
  webSalvageNudges: number
  /** 已经跑完的轮数(轮数烧完的逼卷轮不拦 —— 那轮它没工具可调,拦了也白拦) */
  rounds: number
}

/** 质检闸的裁决:要拦就交出提醒原文与给人看的步骤灰字,放行回 null */
export interface AgentAnswerNudge {
  kind: 'file' | 'web'
  nudge: string
  step: string
}

export function reviewAgentAnswer(input: AgentAnswerReviewInput): AgentAnswerNudge | null {
  // 轮数已烧完的逼卷轮不拦;本场一个工具调用都没发生过也放行 —— 概念题、闲聊
  // 一口答出来是本事,质检闸没资格逼它先翻文件
  if (!input.useTools || input.rounds >= AGENT_MAX_ROUNDS) return null
  if (input.toolCallsExecuted > 0 && input.salvageNudges < SALVAGE_NUDGE_MAX) {
    const gap = findAnswerGap({
      isFindQuestion: isFindQuestion(input.question),
      searchUsed: input.searchUsed,
      hitPaths: input.hitPaths,
      answer: input.answer
    })
    if (gap) {
      return {
        kind: 'file',
        nudge: gap === 'no-search' ? SALVAGE_SEARCH_NUDGE : SALVAGE_CITE_NUDGE,
        step:
          gap === 'no-search'
            ? '这题是找东西,它一次文件都没搜就想交卷 —— 程序拦下,让它先搜再答'
            : '答案里没落到具体文件 —— 程序拦下,让它把搜到的文件写进答案再交'
      }
    }
  }
  // 联网质检闸:只搜了一轮、结果对不上就说没查到 —— 拦一次,让它换短词重搜。
  // 换过词(两次以上)或答案已经引用结果链接的,尊重它的结论,不拦
  if (
    input.webSearchCalls > 0 &&
    input.webSalvageNudges < WEB_SALVAGE_NUDGE_MAX &&
    findWebAnswerGap({
      webSearchCalls: input.webSearchCalls,
      answer: input.answer,
      titles: input.webTitles,
      urls: input.webUrls
    })
  ) {
    return {
      kind: 'web',
      nudge: WEB_SALVAGE_NUDGE,
      step: '这题要联网,它只搜了一轮就说没查到 —— 程序拦下,让它换词再搜'
    }
  }
  return null
}
