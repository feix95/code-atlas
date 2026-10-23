// 联网研究账本:每搜一次/每打开一页,把关键句记在内存里;上下文压缩时只丢原文,
// 不丢事实。账本本身只挂一条,避免每轮叠一张把注意力冲散。
import { TAG } from '../shared/promptTags.ts'
import { AGENT_RESEARCH_PREFIX } from './agentGuard.ts'
import type { AgentChatMessage } from './agentTypes.ts'
import { focusTokens } from './webExtract.ts'

/** 一条研究记录:搜索或打开网页,带程序从原文里挑出的关键句 */
export interface ResearchNote {
  kind: 'search' | 'fetch' | 'note'
  query: string
  url: string
  title: string
  source: string
  facts: string[]
}

/** 账本最多记几条:再多也看不过来,保留最近的 */
export const RESEARCH_NOTE_MAX = 12

/** 每条事实最长多少字:一行说清一件事,不搬整段 */
export const RESEARCH_FACT_MAX_CHARS = 240

/** 账本总字数上限:保证它自己不会变成新的大坨 */
export const RESEARCH_LEDGER_MAX_CHARS = 3000

/** 程序从工具结果里至少挑几条事实 */
const RESEARCH_FACTS_PER_NOTE = 3

/** 太短的句子不当事实(多半是标题残片) */
const RESEARCH_FACT_MIN_CHARS = 8

/** 把工具结果剥成纯文本:XML 标签、多余空白都去掉 */
function plainText(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 按中英文句号/换行切句,保留能独立说清一件事的短句 */
function splitSentences(text: string): string[] {
  return plainText(text)
    .split(/(?<=[。！？.!?])\s*|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= RESEARCH_FACT_MIN_CHARS)
}

/**
 * 从一段工具结果里挑关键句(纯函数,自测覆盖):命中问题词的句子优先,
 * 不够就按原文顺序补;每句裁到上限,最多挑几条。
 */
export function extractResearchFacts(
  text: string,
  focus: string,
  maxFacts = RESEARCH_FACTS_PER_NOTE
): string[] {
  const tokens = focusTokens(focus)
  const sentences = splitSentences(text).map((sentence, index) => {
    const lower = sentence.toLowerCase()
    const score = tokens.reduce((sum, token) => (lower.includes(token) ? sum + 1 : sum), 0)
    return { sentence, index, score }
  })
  const picked = [...sentences]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxFacts)
    .sort((a, b) => a.index - b.index)
  return picked.map((item) =>
    item.sentence.length > RESEARCH_FACT_MAX_CHARS
      ? `${item.sentence.slice(0, RESEARCH_FACT_MAX_CHARS)}…`
      : item.sentence
  )
}

/** 生成一条研究记录;挑不出事实就返回 null,不拿空话占账本 */
export function buildResearchNote(input: {
  kind: ResearchNote['kind']
  query?: string
  url?: string
  title?: string
  source?: string
  text: string
  focus: string
}): ResearchNote | null {
  const facts = extractResearchFacts(input.text, input.focus)
  if (facts.length === 0) return null
  return {
    kind: input.kind,
    query: input.query ?? '',
    url: input.url ?? '',
    title: input.title ?? '',
    source: input.source ?? '',
    facts
  }
}

/** 把新记录并进账本:按「类型 + 查询/地址」去重,只留最近若干条 */
export function addResearchNote(notes: ResearchNote[], note: ResearchNote): ResearchNote[] {
  const key = (item: ResearchNote): string =>
    item.kind === 'search'
      ? `search:${item.query}`
      : item.kind === 'fetch'
        ? `fetch:${item.url}`
        : `note:${item.facts[0] ?? ''}`
  const next = notes.filter((item) => key(item) !== key(note))
  next.push(note)
  return next.slice(-RESEARCH_NOTE_MAX)
}

/**
 * 账本 → 一条程序提醒(纯函数,自测覆盖):事实去重、总长封顶,
 * 让模型在原文被压缩后仍能看见前几轮确认过的东西。
 */
export function formatResearchLedger(
  notes: ResearchNote[],
  maxChars = RESEARCH_LEDGER_MAX_CHARS
): string {
  if (notes.length === 0) return ''
  const seen = new Set<string>()
  const lines: string[] = []
  for (const note of notes) {
    const facts = note.facts.filter((fact) => {
      const key = fact.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (facts.length === 0) continue
    const label =
      note.kind === 'search'
        ? `搜索「${note.query}」`
        : note.kind === 'fetch'
          ? `网页「${note.title || note.url}」${note.url ? `(${note.url})` : ''}`
          : `笔记${note.source ? `(${note.source})` : ''}`
    lines.push(`- ${label}: ${facts.join(';')}`)
  }
  if (lines.length === 0) return ''
  const body = lines.join('\n')
  const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}…` : body
  return `${AGENT_RESEARCH_PREFIX}\n${clipped}\n${TAG.programReminder.close}`
}

/** 对话里只保留最新一张账本:先撤旧卡,再按需垫新卡;没有新卡就只撤 */
export function upsertResearchLedger(
  messages: AgentChatMessage[],
  ledger: string
): AgentChatMessage[] {
  const without = messages.filter(
    (message) =>
      !(
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.startsWith(AGENT_RESEARCH_PREFIX)
      )
  )
  if (ledger === '') return without
  return [...without, { role: 'user', content: ledger }]
}
