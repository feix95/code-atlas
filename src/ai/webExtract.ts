// 网页正文提取:Readability 找正文,去掉导航/广告/页脚,再按问题词挑相关段落。
// 只把一小截喂给模型,避免小上下文被整页正文挤爆。
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { htmlToText, isPublicHttpUrl, WEB_FETCH_MAX_BYTES } from './webGate.ts'

/** 提取结果:正文节选 + 原页总字数 + 是否截断,界面和模型都能据此判断资料够不够 */
export interface ReadablePage {
  title: string
  text: string
  totalChars: number
  truncated: boolean
}

export interface ReadablePageOptions {
  maxChars: number
  /** 本轮问题或搜索词:用来挑相关段落;不传就按原文顺序取开头 */
  focus?: string
}

/** 参与对账的词最短长度:单字太容易误命中 */
const FOCUS_MIN_CHARS = 2

/** 常见英文停用词:避免 "the/and" 这类词把无关段落拉进来 */
const FOCUS_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'what',
  'how',
  'why',
  'are',
  'was',
  'were',
  'you',
  'your',
  'can',
  'could',
  'should',
  'would',
  'about',
  'into',
  'than',
  'then',
  'there',
  'their',
  'they',
  'have',
  'has',
  'had',
  'not',
  'but',
  'all',
  'any',
  'our',
  'out',
  'use',
  'using'
])

/** 把网页文本压成规整段落:统一换行、压掉多余空白和空行 */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 从问题/搜索词里抽对账词:中文按短语、英文按单词,去掉停用词 */
export function focusTokens(focus: string): string[] {
  const tokens = focus
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= FOCUS_MIN_CHARS && !FOCUS_STOP_WORDS.has(token))
  return [...new Set(tokens)]
}

function scoreParagraph(paragraph: string, tokens: string[]): number {
  if (tokens.length === 0) return 0
  const lower = paragraph.toLowerCase()
  return tokens.reduce((score, token) => (lower.includes(token) ? score + 1 : score), 0)
}

/** 单段最长保留多少字:Readability 有时把整页塞进一段,先切成可打分的块 */
const MAX_BLOCK_CHARS = 300

/** 把超长段落切成小块:优先按句号,单句仍超长就硬切,保证每块能参与相关度打分 */
function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_BLOCK_CHARS) return [paragraph]
  const sentences = paragraph.split(/(?<=[。！？.!?])\s*/u)
  const blocks: string[] = []
  let current = ''
  const flush = (): void => {
    if (current.trim() !== '') blocks.push(current.trim())
    current = ''
  }
  for (const sentence of sentences) {
    if (sentence === '') continue
    let rest = sentence
    while (rest.length > 0) {
      const room = MAX_BLOCK_CHARS - current.length
      if (room <= 0) {
        flush()
        continue
      }
      const piece = rest.slice(0, room)
      current += piece
      rest = rest.slice(piece.length)
      if (current.length >= MAX_BLOCK_CHARS) flush()
    }
  }
  flush()
  return blocks.length > 0 ? blocks : [paragraph.slice(0, MAX_BLOCK_CHARS)]
}

/**
 * 按相关度挑段落(纯函数,自测覆盖):先收命中问题词的段落,再用开头段落补上下文,
 * 最后按原文顺序拼回去;总长不超过 maxChars。
 */
export function pickRelevantExcerpts(text: string, focus: string, maxChars: number): string {
  const normalized = normalizeText(text)
  if (normalized.length <= maxChars) return normalized
  const tokens = focusTokens(focus)
  const paragraphs = normalized
    .split(/\n{2,}/)
    .flatMap((paragraph) => splitLongParagraph(paragraph.trim()))
    .filter((paragraph) => paragraph !== '')
  if (paragraphs.length === 0) return normalized.slice(0, maxChars).trim()
  const scored = paragraphs.map((paragraph, index) => ({
    paragraph,
    index,
    score: scoreParagraph(paragraph, tokens)
  }))
  const selected: typeof scored = []
  let used = 0
  // 第一轮:命中越多的段落越先收,保证关键段不会被前面的长段落挤掉
  const byScore = [...scored].sort((a, b) => b.score - a.score || a.index - b.index)
  for (const item of byScore) {
    if (item.score <= 0) continue
    if (used + item.paragraph.length + 2 > maxChars) continue
    selected.push(item)
    used += item.paragraph.length + 2
  }
  // 第二轮:还有空间就用开头段落补上下文,补到八成满就停
  for (const item of scored) {
    if (selected.includes(item)) continue
    if (used + item.paragraph.length + 2 > maxChars) continue
    selected.push(item)
    used += item.paragraph.length + 2
    if (used >= maxChars * 0.8) break
  }
  if (selected.length === 0) {
    // 一段都没命中:退到第一个关键词附近的窗口;连关键词都没有就取开头
    const firstHit = tokens
      .map((token) => normalized.toLowerCase().indexOf(token))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0]
    const start = firstHit === undefined ? 0 : Math.max(0, firstHit - Math.floor(maxChars / 3))
    return normalized.slice(start, start + maxChars).trim()
  }
  selected.sort((a, b) => a.index - b.index)
  const excerpt = selected.map((item) => item.paragraph).join('\n\n')
  return excerpt.length > maxChars ? excerpt.slice(0, maxChars).trim() : excerpt
}

/**
 * 从 HTML 提取正文(纯函数,自测覆盖):Readability 能认出正文就先用它,
 * 认不出就退回正则剥标签;再按问题词挑段落。绝不抛错。
 */
export function extractReadablePage(html: string, opts: ReadablePageOptions): ReadablePage {
  let title = ''
  let raw = ''
  try {
    const { document } = parseHTML(html)
    const article = new Readability(document, { charThreshold: 0 }).parse()
    if (article) {
      title = article.title ?? ''
      raw = article.textContent ?? ''
    }
  } catch {
    // 坏 HTML / Readability 认不出:走下面的正则兜底
  }
  if (raw.trim() === '') raw = htmlToText(html)
  const normalized = normalizeText(raw)
  const totalChars = normalized.length
  const text = pickRelevantExcerpts(normalized, opts.focus ?? '', opts.maxChars)
  return { title, text, totalChars, truncated: totalChars > text.length }
}

/** 抓一页并提取正文:内网地址直接回空,网络错误原样抛给调用方兜 */
export async function fetchReadablePage(
  url: string,
  fetchText: (url: string) => Promise<string>,
  opts: ReadablePageOptions
): Promise<ReadablePage> {
  if (!isPublicHttpUrl(url)) return { title: '', text: '', totalChars: 0, truncated: false }
  const html = await fetchText(url)
  return extractReadablePage(html.slice(0, WEB_FETCH_MAX_BYTES), opts)
}
