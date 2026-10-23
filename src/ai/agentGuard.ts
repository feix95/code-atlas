// agent 的防打转与质检闸:提醒话术、找位置题/联网题的拦截判据、提醒卡的垫与撤。
// 全是纯函数 + 常量(自测直接喂),不动会话状态。
import { TAG } from '../shared/promptTags.ts'
import { TOOL_NAMES } from '../shared/agentTools.ts'
import type { AgentChatMessage } from './agentTypes.ts'

/** 同一样东西翻第二遍时,当工具结果喂回去的提醒(护栏之一;主进程外层再包 tool_result) */
export const REPEAT_NUDGE = `${TAG.programNote.open}这个你刚才已经看过了,名单和内容都没变 —— 别再翻,直接用已经看到的资料继续干活或回答。${TAG.programNote.close}`

/** 工具轮数烧完后的逼卷令:当一条普通消息插进对话,模型只能交答案 */
export const ROUND_CAP_NUDGE = `${TAG.programReminder.open}\n翻看步数已到上限 —— 别再调用任何工具了,就用现在已经看到的资料,直接把答案完整说完。\n${TAG.programReminder.close}`

/** 质检闸的补救提醒封顶一次:掰不过来就随它交卷 —— 宁可答案差点,
 *  也不能让用户看着正文收了又吐、吐了又收空等(2026-09-17 产品定) */
export const SALVAGE_NUDGE_MAX = 1

/** 质检闸·判据一(过程)的补救提醒:找东西的题一次都没搜就交卷,拦下逼它先搜。
 *  开头自报家门(小模型老把程序插话当用户催促),点明只是补搜索、不用重新理解问题 */
export const SALVAGE_SEARCH_NUDGE = `${TAG.programReminder.open}\n程序自动质检,不是用户说话。按规矩,找位置的答案要落到具体文件 —— 你到现在还没用 ${TOOL_NAMES.searchContent} 搜过就交卷了。先挑一两个短关键词搜一搜(它连文件路径都能搜),搜完真没有就明说没找到。这只是补个搜索,问题本身没变,不用重新理解。\n${TAG.programReminder.close}`

/** 质检闸·判据二(结果)的补救提醒:搜是搜了,答案里却一个具体文件都没引用,拦下逼它补 */
export const SALVAGE_CITE_NUDGE = `${TAG.programReminder.open}\n程序自动质检,不是用户说话。上一轮回答没引用具体文件路径,格式校验没过 —— 不用重新理解问题,也不用推翻答案,把搜到的命中里相关的文件路径补写进答案就行;真没有合适的就明说。\n${TAG.programReminder.close}`

/** 联网质检闸的补救提醒:只搜一轮、结果对不上就交卷时,拦下让它换词再搜。
 *  开头自报家门(小模型老把程序插话当用户催促),并明确「只搜一轮不算查过」 */
export const WEB_SALVAGE_NUDGE = `${TAG.programReminder.open}\n程序自动质检,不是用户说话。你只搜了一轮,结果对不上就说没查到 —— 这不算查过。换 2-3 个更短、更准的词再搜:先只搜主体本身,再按方面补短词;别把对话里其他产品名拼进去。问题本身没变,不用重新理解。\n${TAG.programReminder.close}`

/** 联网质检闸最多拦一次:换过词还说没查到,就尊重它的结论,不无限跟它耗 */
export const WEB_SALVAGE_NUDGE_MAX = 1

/** 找位置题的特征词(宁保守勿激进):命中才认「找东西的题」,质检闸只管这类,别的不多管闲事。
 *  「搜一下/搜搜/搜出」这类泛搜语气词不进表(2026-09-17 产品定):带"搜"字的问句多半是
 *  「帮我查查这是什么」,不是「找位置」—— 「搜一下这个文件夹是什么」曾因此被误拦,
 *  模型明明用联网搜索答对了,却被闸逼着重搜本地文件,白白重来三轮 */
const FIND_QUESTION_WORDS = [
  '在哪',
  '哪里',
  '哪儿',
  '找找',
  '找出',
  '找到',
  '安装在哪',
  '装在哪',
  '安装位置',
  '安装目录',
  '装到哪',
  'where',
  'locate'
]

/** 这是不是一道「找东西/找位置」的题(纯函数,自测覆盖):质检闸的门卫 */
export function isFindQuestion(question: string): boolean {
  const q = question.toLowerCase()
  return FIND_QUESTION_WORDS.some((w) => q.includes(w))
}

/** 答案里有没有引用具体文件(纯函数,自测覆盖):拿本场搜索的命中路径对账,
 *  斜杠方向和大小写都放平了比 —— 模型抄路径爱跑偏。
 *  完整 relPath 没对上时再看末段文件名:模型爱写短路径(「在 logs/cc-switch.log 里」
 *  少写前缀),按老口径全算「没引用」冤枉它,白白拦一轮 —— 文件名级对账放过这种;
 *  可点跳转另有程序摆的命中清单卡兜底,答案文本里少个长路径不伤功能 */
export function answerCitesAnyHit(answer: string, hitPaths: string[]): boolean {
  const norm = answer.toLowerCase().replace(/\\/g, '/')
  return hitPaths.some((p) => {
    const path = p.toLowerCase().replace(/\\/g, '/')
    if (path !== '' && norm.includes(path)) return true
    const base = path.split('/').pop() ?? ''
    return base !== '' && norm.includes(base)
  })
}

/** 质检闸的裁决(纯函数,自测覆盖) */
export type FindSalvageVerdict = 'no-search' | 'no-files'

/**
 * 质检闸(纯函数,自测覆盖):找位置题的答案交卷前过一遍 ——
 * 判据一(过程):一次都没搜过 → 逼它先搜;判据二(结果):搜到了东西,答案里
 * 却一个具体文件都没引用 → 逼它把文件写进答案。搜了但颗粒无收(hitPaths 空)
 * 是合法的「真没有」,放行;不是找位置题也放行。返回 null = 放行交卷。
 */
export function findAnswerGap(input: {
  isFindQuestion: boolean
  searchUsed: boolean
  hitPaths: string[]
  answer: string
}): FindSalvageVerdict | null {
  if (!input.isFindQuestion) return null
  if (!input.searchUsed) return 'no-search'
  if (input.hitPaths.length === 0) return null
  return answerCitesAnyHit(input.answer, input.hitPaths) ? null : 'no-files'
}

/** 「没查到」的自白词表:只用来识别模型放弃交卷,不拿它判断真假 */
const WEB_GIVE_UP_WORDS = [
  '没查到',
  '没有查到',
  '查不到',
  '未查到',
  '没搜到',
  '没有搜到',
  '搜不到',
  '没找到',
  '没有找到',
  '没有直接命中',
  '无法直接',
  '信息不足',
  '资料不足',
  "couldn't find",
  'could not find',
  'unable to find',
  'not found',
  'no results'
]

const WEB_APOLOGY_GIVE_UP = /(很抱歉|抱歉|对不起)[^。！？\n]{0,30}(无法|没法|不能|没能|没有)/

/** 答案是不是在说「我放弃了/没查到」(纯函数,自测覆盖) */
export function answerLooksLikeWebGiveUp(answer: string): boolean {
  const text = answer.toLowerCase()
  return WEB_GIVE_UP_WORDS.some((w) => text.includes(w)) || WEB_APOLOGY_GIVE_UP.test(text)
}

/** 答案里有没有引用搜索结果的链接/标题/域名(纯函数,自测覆盖):模型爱把链接写成裸域名 */
export function answerCitesAnyWebResult(answer: string, titles: string[], urls: string[]): boolean {
  const text = answer.toLowerCase().replace(/\\/g, '/')
  const citedUrl = urls.some((url) => {
    const clean = url.toLowerCase().replace(/\/+$/, '')
    return clean !== '' && text.includes(clean)
  })
  if (citedUrl) return true
  const citedHost = urls.some((url) => {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
      return host !== '' && text.includes(host)
    } catch {
      return false
    }
  })
  if (citedHost) return true
  return titles.some((title) => {
    const clean = title.toLowerCase().trim()
    return clean.length >= 6 && text.includes(clean)
  })
}

/**
 * 联网质检闸(纯函数,自测覆盖):只搜了一轮、拿到的结果对不上,就交卷说「没查到」——
 * 这是小模型最常犯的偷懒,拦下逼它换 2-3 个短词再搜。真正换过词(搜了两次以上)或
 * 答案已经引用了结果里的链接,就尊重它的结论,不再拦。返回 true = 要拦。
 */
export function findWebAnswerGap(input: {
  /** 本场真正发起过几次联网搜索(被防打转拦下的重复词不算) */
  webSearchCalls: number
  answer: string
  titles: string[]
  urls: string[]
}): boolean {
  if (input.webSearchCalls !== 1) return false
  if (!answerLooksLikeWebGiveUp(input.answer)) return false
  return !answerCitesAnyWebResult(input.answer, input.titles, input.urls)
}

/** 提醒卡的触发门槛(提示词体系重写第二批):本场工具调用满这么多次才开始垫提醒卡 ——
 *  前两三轮资料还少,提醒卡只会稀释注意力,不垫 */
export const AGENT_REMINDER_MIN_TOOL_CALLS = 3

/** 提醒卡的内容前缀:撤旧卡、兜底识别都靠它认(别在别处拼这个前缀) */
export const AGENT_REMINDER_PREFIX = `${TAG.programReminder.open}\n本轮要回答的问题:`

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
