// 联网查证的问题端:挑搜索词、读联网信号、追问拼装 —— 全是纯函数,不发请求。
import type { ChatContextAttachment, WebLookupMeta } from '../shared/types.ts'
import { TAG } from '../shared/promptTags.ts'

/**
 * 联网查询用哪个词去查:优先拿选中对象的名字(只是名字,绝不发路径);
 * 没选中东西时,把问题里的联网意图词剥掉,剩下的当查询词(封顶 60 字防垃圾长串)。
 */
export function pickWebLookupQuery(
  question: string,
  attachment: ChatContextAttachment | null
): string {
  const name = attachment && attachment.targetType !== 'none' ? attachment.name.trim() : ''
  if (name) return name
  return question
    .replace(/联网|搜索|搜搜|搜一下|查查|查一下|上网|网上|百度|谷歌|帮我|search/gi, ' ')
    .replace(/[\s,。?!?!、·::""'']+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
}

/**
 * 把程序真实执行过的联网动作收敛成状态账本:
 * material = null 表示查询本身失败(网络/超时);'' 表示查完了但没有可用资料;
 * 有内容才是 completed,并把命中的来源记进去。模型的自述不参与记账。
 */
export function resolveWebLookupMeta(
  requested: boolean,
  enabled: boolean,
  outcome:
    | { kind: 'skipped' }
    | { kind: 'attempted'; material: string; sources: string[] }
    | { kind: 'error' }
): WebLookupMeta {
  if (!requested)
    return { requested: false, enabled, attempted: false, state: 'not_requested', sources: [] }
  if (!enabled)
    return { requested: true, enabled: false, attempted: false, state: 'disabled', sources: [] }
  if (outcome.kind === 'skipped')
    return { requested: true, enabled: true, attempted: false, state: 'failed', sources: [] }
  if (outcome.kind === 'error')
    return { requested: true, enabled: true, attempted: true, state: 'failed', sources: [] }
  if (outcome.material === '')
    return { requested: true, enabled: true, attempted: true, state: 'empty', sources: [] }
  return {
    requested: true,
    enabled: true,
    attempted: true,
    state: 'completed',
    sources: outcome.sources
  }
}

/**
 * 联网查证的信号词(可选功能,默认关):只在整个功能开启时才把这句补充要求附在
 * 证据后面,让模型"认出像某个软件但说不准是谁"时打一个信号,不搞复杂的置信度打分。
 */
export const WEB_SIGNAL_INSTRUCTION = `\n\n${TAG.programNote.open}补充要求:如果你认出这些名字像是某个具体软件/品牌留下的,但说不准它到底是谁,就在回答的最后单独一行写「需要联网确认」,其余内容照常讲。如期能认出来,就不要写这行。${TAG.programNote.close}`

/** 讲解回答里带没带联网信号 */
export function hasWebLookupSignal(answer: string): boolean {
  return answer.includes('需要联网确认')
}

/**
 * 追问里有没有点名叫联网/搜索:这类词命中且开关开着,才把联网资料塞进这一轮。
 * 词表放得宽(搜搜/查一下/网上都算),误触发顶多多查一次,不伤功能。
 */
export function hasSearchIntent(question: string): boolean {
  return /联网|搜索|搜搜|搜一下|查查|查一下|上网|网上|百度|谷歌|search/i.test(question)
}

/**
 * 组「联网修正」的消息:原对话(证据+首答)垫底,联网资料作为新的用户消息进场,
 * 让模型重新给一版更准确的结论;资料对不上就基本维持原话,不硬编。
 */
export function buildRefineMessages(
  system: string,
  evidence: string,
  firstAnswer: string,
  material: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    { role: 'system', content: system },
    { role: 'user', content: evidence },
    { role: 'assistant', content: firstAnswer },
    {
      role: 'user',
      content:
        `${material}\n\n` +
        `请结合 ${TAG.webResults.open} 里的公开资料,把上面那段讲解修正成更准确的一版:说得清是什么软件/品牌就明说;资料对不上或没帮助,就基本维持原话,别硬编。` +
        '不要写「需要联网确认」这个标记,直接给修正后的结论。'
    }
  ]
}
