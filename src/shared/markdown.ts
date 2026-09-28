/**
 * 迷你 Markdown 解析器(阅读模式锤起):把手写 md 拆成纯数据 AST,
 * 渲染交给 MiniMD.tsx —— 解析与描画分家,这里不碰 React、不碰 DOM,
 * 自测可以直接把 AST 对账本,不必过浏览器。
 *
 * 块级:围栏代码、#~#### 标题、hr、无序/有序/嵌套/待办列表、> 引用(多行合并)、
 *      > [!type] callout、| 管道表格(对齐)、段落(相邻行合并,CommonMark 语义)。
 * 行内:`代码`、双星/双划线粗体、单星/单划线斜体、~~删~~、==亮==、[文](链)。
 * 文件链接不走这里 —— 那是渲染层拿着工作区索引对账的活,AST 里只是普通 text。
 */

// ── 行内 AST ──

export type MdInline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'bold'; text: string }
  | { t: 'em'; text: string }
  | { t: 'del'; text: string }
  | { t: 'mark'; text: string }
  | { t: 'link'; label: string; href: string }

// ── 块级 AST ──

export type MdAlign = 'left' | 'center' | 'right'
export type MdCalloutKind = 'note' | 'tip' | 'warn' | 'danger' | 'quote'

export interface MdListItem {
  content: MdInline[]
  /** 待办项的勾选态;undefined = 不是待办 */
  done?: boolean
  /** 挂在该项肚子里的子列表 */
  sub?: MdList
}

export interface MdList {
  t: 'list'
  ordered: boolean
  items: MdListItem[]
}

export type MdBlock =
  | { t: 'code'; text: string }
  | { t: 'heading'; level: number; content: MdInline[] }
  | { t: 'hr' }
  | { t: 'table'; head: MdInline[][]; aligns: MdAlign[]; body: MdInline[][][] }
  | MdList
  | { t: 'quote'; children: MdBlock[] }
  | { t: 'callout'; kind: MdCalloutKind; title: string; children: MdBlock[] }
  | { t: 'para'; content: MdInline[] }

// ── 行内解析 ──

/**
 * `代码` 先单独摘走(里面的字一个语法都不认),剩下的走一把合并正则。
 * 交替顺序即优先级:粗体(双星/双划线)必须先于斜体(单星/单划线)进表,不然 ** 会被 * 抢走吃一半;
 * _斜体_ 两侧不许贴单词字符(CommonMark:_ 不参与词内强调,a_b_c 不该斜)。
 */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = []
  const codeRe = /`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > last) out.push(...parseRich(text.slice(last, m.index)))
    out.push({ t: 'code', text: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(...parseRich(text.slice(last)))
  return out
}

function parseRich(t: string): MdInline[] {
  const out: MdInline[] = []
  const re =
    /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|(?<![\w])_([^_\n]+)_(?![\w])|~~([^~]+)~~|==([^=]+)==|\[([^\]]+)\]\(([^)]+)\)/g
  let last = 0
  let pm: RegExpExecArray | null
  while ((pm = re.exec(t)) !== null) {
    if (pm.index > last) out.push({ t: 'text', text: t.slice(last, pm.index) })
    if (pm[1] !== undefined || pm[2] !== undefined) {
      out.push({ t: 'bold', text: pm[1] ?? pm[2] ?? '' })
    } else if (pm[3] !== undefined || pm[4] !== undefined) {
      out.push({ t: 'em', text: pm[3] ?? pm[4] ?? '' })
    } else if (pm[5] !== undefined) {
      out.push({ t: 'del', text: pm[5] })
    } else if (pm[6] !== undefined) {
      out.push({ t: 'mark', text: pm[6] })
    } else {
      out.push({ t: 'link', label: pm[7] ?? '', href: pm[8] ?? '' })
    }
    last = pm.index + pm[0].length
  }
  if (last < t.length) out.push({ t: 'text', text: t.slice(last) })
  return out
}

// ── 块级认家 ──

const RE_FENCE = /^\s*```/
const RE_HEADING = /^(#{1,4})\s+(.*)$/
const RE_HR = /^(-{3,}|\*{3,}|_{3,})$/
const RE_LIST = /^(\s*)([-*•]|\d+[.、)])\s+(.*)$/
const RE_QUOTE = /^\s*>/
const RE_TASK = /^\[( |x|X)\]\s+(.*)$/
const RE_CALLOUT = /^\[!([A-Za-z]+)\][+-]?\s*(.*)$/

/** 表格分隔行:|---|:--:|---:| —— 每格只许是 冒号+至少两横+冒号 */
function isTableSep(line: string): boolean {
  const s = line.trim()
  if (!s.includes('|')) return false
  return splitCells(s).every((c) => /^:?-{2,}:?$/.test(c))
}

/** 表头行候选:行里有 |,下一行正好是分隔行 */
function isTableStart(lines: string[], i: number): boolean {
  return i + 1 < lines.length && lines[i].includes('|') && isTableSep(lines[i + 1])
}

/** 管道行拆格:掐头去尾的 |,按 | 分,逐格修边 */
function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|+|\|+$/g, '')
    .split('|')
    .map((c) => c.trim())
}

/** 分隔行的对齐户口::--: 居中、--: 右、其余左 */
function sepAligns(line: string): MdAlign[] {
  return splitCells(line).map((c) => {
    const l = c.startsWith(':')
    const r = c.endsWith(':')
    return l && r ? 'center' : r ? 'right' : 'left'
  })
}

/** 这行会不会把段落截断(块起点判定) */
function isBlockStart(lines: string[], i: number): boolean {
  const t = lines[i].trim()
  return (
    t === '' ||
    RE_FENCE.test(t) ||
    RE_HEADING.test(t) ||
    RE_HR.test(t) ||
    RE_LIST.test(lines[i]) ||
    RE_QUOTE.test(lines[i]) ||
    isTableStart(lines, i)
  )
}

interface RawListItem {
  indent: number
  ordered: boolean
  text: string
}

/** 散行的列表项按缩进折成树:更深的紧跟项挂进上一项的 sub(子列表进父 li) */
function foldList(items: RawListItem[]): MdList {
  let pos = 0
  function build(indent: number): MdList {
    // 同级共用列表类型(以该层第一项为准;混排稀有,不拆两张表)
    const list: MdList = { t: 'list', ordered: items[pos].ordered, items: [] }
    while (pos < items.length && items[pos].indent >= indent) {
      const it = items[pos]
      if (it.indent > indent) break
      pos++
      const tm = RE_TASK.exec(it.text)
      const li: MdListItem =
        tm === null
          ? { content: parseInline(it.text) }
          : { content: parseInline(tm[2]), done: tm[1] !== ' ' }
      if (pos < items.length && items[pos].indent > indent) {
        li.sub = build(items[pos].indent)
      }
      list.items.push(li)
    }
    return list
  }
  return build(items[0]?.indent ?? 0)
}

/** callout 类型名 → 色板户口(Obsidian 常见档名映射) */
const CALLOUT_KIND: Record<string, MdCalloutKind> = {
  note: 'note',
  info: 'note',
  todo: 'note',
  question: 'note',
  faq: 'note',
  tip: 'tip',
  hint: 'tip',
  success: 'tip',
  check: 'tip',
  done: 'tip',
  warning: 'warn',
  caution: 'warn',
  attention: 'warn',
  danger: 'danger',
  error: 'danger',
  fail: 'danger',
  failure: 'danger',
  bug: 'danger',
  quote: 'quote',
  cite: 'quote',
  example: 'quote'
}

export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.split('\n')
  const out: MdBlock[] = []
  let i = 0
  while (i < lines.length) {
    const t = lines[i].trim()
    if (t === '') {
      i++
      continue
    }
    // 围栏代码块:原样进 code,一个字不动(语法检测一概不进围栏)
    if (RE_FENCE.test(t)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i])
        i++
      }
      i++
      out.push({ t: 'code', text: buf.join('\n') })
      continue
    }
    const h = RE_HEADING.exec(t)
    if (h) {
      out.push({ t: 'heading', level: h[1].length, content: parseInline(h[2]) })
      i++
      continue
    }
    if (RE_HR.test(t)) {
      out.push({ t: 'hr' })
      i++
      continue
    }
    // 管道表格:头行 + 分隔行 + 若干数据行;单元格走行内语法(粗体/代码/链接照吃)
    if (isTableStart(lines, i)) {
      const head = splitCells(lines[i]).map(parseInline)
      const aligns = sepAligns(lines[i + 1])
      i += 2
      const body: MdInline[][][] = []
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        body.push(splitCells(lines[i]).map(parseInline))
        i++
      }
      out.push({ t: 'table', head, aligns, body })
      continue
    }
    // 列表(无序/有序/嵌套/待办):连收的项按缩进折树
    if (RE_LIST.test(lines[i])) {
      const items: RawListItem[] = []
      while (i < lines.length) {
        const lm = RE_LIST.exec(lines[i])
        if (!lm) break
        items.push({
          indent: lm[1].replace(/\t/g, '  ').length,
          ordered: /\d/.test(lm[2]),
          text: lm[3]
        })
        i++
      }
      out.push(foldList(items))
      continue
    }
    // 引用块:连续 > 行收成一段内文递归走块级(引用里可以有列表/标题/表格);
    // 首行 [!type] 升级成 callout(Obsidian 招牌),标题可自定义
    if (RE_QUOTE.test(lines[i])) {
      const inner: string[] = []
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        inner.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      const cm = RE_CALLOUT.exec(inner[0]?.trim() ?? '')
      if (cm) {
        const kind = CALLOUT_KIND[cm[1].toLowerCase()] ?? 'note'
        out.push({
          t: 'callout',
          kind,
          title: cm[2].trim() || cm[1].toLowerCase(),
          children: parseMarkdown(inner.slice(1).join('\n'))
        })
      } else {
        out.push({ t: 'quote', children: parseMarkdown(inner.join('\n')) })
      }
      continue
    }
    // 段落:相邻非块行合并成一段(CommonMark:软换行当空格,空行才分段)
    const buf = [lines[i].trimEnd()]
    i++
    while (i < lines.length && !isBlockStart(lines, i)) {
      buf.push(lines[i].trimEnd())
      i++
    }
    out.push({ t: 'para', content: parseInline(buf.join('\n')) })
  }
  return out
}
