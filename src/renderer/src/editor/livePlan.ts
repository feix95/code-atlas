/**
 * Live Preview 的清单规划层:语法树 → 「装饰清单」(纯函数,自测直接喂)。
 * 只管判断「哪里该上妆、哪里该卸妆」,不碰 CM6 的 Decoration —— 转成真装饰在 markdownLive。
 */
import { markdownLanguage } from '@codemirror/lang-markdown'
import type { Tree, SyntaxNode } from '@lezer/common'

/** 装饰清单的一行:planLiveDecos 的产出(纯数据,自测对着它对账) */
export type LiveDeco =
  /** 整行换皮:标题字号 / 引用条 / 代码块底(只用到行首的 from) */
  | { t: 'line'; from: number; cls: string }
  /** 记号藏掉:# 号、** 星、反引号、`>` 引号、链接括号与 URL */
  | { t: 'hide'; from: number; to: number }
  /** 范围染色:斜体/粗体/删除线/行内代码药丸/链接/有序号 */
  | { t: 'mark'; from: number; to: number; cls: string }
  /** 无序列表记号换成小圆点 • */
  | { t: 'bullet'; from: number; to: number }
  /** 待办记号 [ ]/[x] 换成真复选框(可点,点了改文档) */
  | { t: 'task'; from: number; to: number; checked: boolean }
  /** 分割线行整块换成真横线 */
  | { t: 'hr'; from: number; to: number }
  /** 管道表格整块换成真表格(复用 MiniMD 同款类名) */
  | { t: 'table'; from: number; to: number }

export interface LiveRange {
  from: number
  to: number
}

/** ATX 标题:# ~ ######;下划线标题单独认(它的横线行要整行关闭) */
const RE_ATX = /^ATXHeading([1-6])$/

/** 光标选区跟语法块交不交差:交差 = 这个块正在卸妆期,记号不藏 */
function inSel(sel: readonly LiveRange[], n: LiveRange): boolean {
  return sel.some((s) => s.from <= n.to && s.to >= n.from)
}

/**
 * 语法树 → 装饰清单(纯函数,自测覆盖)。
 * selRanges:编辑器当前选区(光标也算,from===to);
 * iterRanges:要盘点的范围(编辑器只盘可见区,自测给整份);
 * lineStarts:某段文本覆盖的各行行首偏移;read:按偏移取原文。
 */
export function planLiveDecos(
  tree: Tree,
  selRanges: readonly LiveRange[],
  iterRanges: readonly LiveRange[],
  lineStarts: (from: number, to: number) => number[],
  read: (from: number, to: number) => string
): LiveDeco[] {
  const out: LiveDeco[] = []
  /**
   * 祖先栈:iter 回调里的 SyntaxNode 是游标借来的幻影(离开就改头换面),
   * parent 也拿不到真名 —— 存 {name,from,to} 快照,谁是谁的爹自己记账;
   * enter 里 return false = 不进子代且不进栈(leave 不会回调,别留赃)。
   */
  const stack: { name: string; from: number; to: number }[] = []
  const anc = (depth: number): { name: string; from: number; to: number } | undefined =>
    stack[stack.length - 1 - depth]
  const lineCls = (n: LiveRange, cls: string): void => {
    for (const s of lineStarts(n.from, n.to)) out.push({ t: 'line', from: s, cls })
  }
  for (const r of iterRanges) {
    tree.iterate({
      from: r.from,
      to: r.to,
      enter(node: SyntaxNode): boolean | void {
        const name = node.name
        const on = inSel(selRanges, node)
        const atx = RE_ATX.exec(name)
        if (atx) {
          // 标题行总是大字号(卸妆也在 —— Obsidian 同款);记号藏不藏看在不在场
          lineCls(node, `cm-live-h${atx[1]}`)
          stack.push({ name: node.name, from: node.from, to: node.to })
          return
        }
        if (name === 'SetextHeading1' || name === 'SetextHeading2') {
          const lvl = name.endsWith('1') ? 1 : 2
          const starts = lineStarts(node.from, node.to)
          starts.forEach((s, i) => {
            // 首行是标题本体;后续行是 ===/--- 下划线,不在场就压成零高隐身
            out.push({
              t: 'line',
              from: s,
              cls: i === 0 ? `cm-live-h${lvl}` : on ? '' : 'cm-live-setext'
            })
          })
          stack.push({ name: node.name, from: node.from, to: node.to })
          return
        }
        switch (name) {
          case 'HeaderMark': {
            // # 记号连同它后面那个空格一起藏,标题不凹陷
            const p = anc(0)
            if (p && RE_ATX.test(p.name) && !inSel(selRanges, p)) {
              let to = node.to
              if (read(to, to + 1) === ' ') to += 1
              out.push({ t: 'hide', from: node.from, to })
            }
            return false
          }
          case 'EmphasisMark':
          case 'StrikethroughMark': {
            const p = anc(0)
            if (p && !inSel(selRanges, p)) out.push({ t: 'hide', from: node.from, to: node.to })
            return false
          }
          case 'CodeMark': {
            // 行内代码的反引号不在场就藏;围栏代码块的 ``` 留着(走行皮压暗)
            const p = anc(0)
            if (p && p.name === 'InlineCode' && !inSel(selRanges, p))
              out.push({ t: 'hide', from: node.from, to: node.to })
            return false
          }
          case 'QuoteMark': {
            const p = anc(0)
            if (p && !inSel(selRanges, p)) out.push({ t: 'hide', from: node.from, to: node.to })
            return false
          }
          case 'LinkMark': {
            // [ ] ( ) 这堆括号记号:宿主(链接/图片)不在场就全藏
            const p = anc(0)
            if (p && !inSel(selRanges, p)) out.push({ t: 'hide', from: node.from, to: node.to })
            return false
          }
          case 'URL':
          case 'LinkTitle': {
            // 链接尾巴 (http://…) 不在场藏掉;Autolink 的 URL 是本体不藏
            const p = anc(0)
            if (p && (p.name === 'Link' || p.name === 'Image') && !inSel(selRanges, p))
              out.push({ t: 'hide', from: node.from, to: node.to })
            return false
          }
          case 'ListMark': {
            // 无序 -/*/+ 换小圆点,有序 1. 留着上主题色
            const item = anc(0)
            const list = anc(1)
            if (list?.name === 'OrderedList')
              out.push({ t: 'mark', from: node.from, to: node.to, cls: 'cm-live-num' })
            else if (item && !inSel(selRanges, item))
              out.push({ t: 'bullet', from: node.from, to: node.to })
            return false
          }
          case 'TaskMarker': {
            // [ ]/[x] 换真复选框(可点勾);它的爹是 Task,Task 的爹才是 ListItem ——
            // 「在场」照整项算(光标碰这行任意处都卸妆),stack 掏不出就退回爷辈
            const item = anc(1) ?? anc(0)
            if (item && !inSel(selRanges, item)) {
              out.push({
                t: 'task',
                from: node.from,
                to: node.to,
                checked: /x/i.test(read(node.from, node.to))
              })
            }
            return false
          }
          case 'Emphasis':
            out.push({ t: 'mark', from: node.from, to: node.to, cls: 'cm-live-em' })
            break
          case 'StrongEmphasis':
            out.push({ t: 'mark', from: node.from, to: node.to, cls: 'cm-live-strong' })
            break
          case 'Strikethrough':
            out.push({ t: 'mark', from: node.from, to: node.to, cls: 'cm-live-del' })
            break
          case 'InlineCode':
            // 药丸皮罩整个节点(反引号不在场时被藏,吃不到皮;在场时连反引号一起上药丸,
            // 跟 Obsidian 编辑内文时的样子一致)
            out.push({ t: 'mark', from: node.from, to: node.to, cls: 'cm-live-code' })
            break
          case 'Link':
            if (!on) out.push({ t: 'mark', from: node.from, to: node.to, cls: 'cm-live-link' })
            break
          case 'Image':
            if (!on) out.push({ t: 'mark', from: node.from, to: node.to, cls: 'cm-live-img' })
            break
          case 'Autolink':
            if (!on) out.push({ t: 'mark', from: node.from, to: node.to, cls: 'cm-live-link' })
            break
          case 'Blockquote':
            lineCls(node, 'cm-live-quote')
            break
          case 'FencedCode': {
            // 围栏块逐行上底;首尾 ``` 行再压暗一档(语言名也在这行)
            const starts = lineStarts(node.from, node.to)
            starts.forEach((s, i) => {
              const fence = i === 0 || i === starts.length - 1
              out.push({
                t: 'line',
                from: s,
                cls: `cm-live-codeblock${fence ? ' cm-live-fence' : ''}`
              })
            })
            return false
          }
          case 'CodeBlock':
            lineCls(node, 'cm-live-codeblock')
            return false
          case 'HorizontalRule':
            if (!on) out.push({ t: 'hr', from: node.from, to: node.to })
            return false
          case 'Table':
            if (!on) out.push({ t: 'table', from: node.from, to: node.to })
            return false
          default:
            break
        }
        stack.push({ name: node.name, from: node.from, to: node.to })
      },
      leave() {
        stack.pop()
      }
    })
  }
  return out
}

/** 自测专用:纯 node 环境下给一段 md 算出装饰清单 */
export function planLiveDecosForText(text: string, selFrom: number, selTo: number): LiveDeco[] {
  const tree = markdownLanguage.parser.parse(text)
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return planLiveDecos(
    tree,
    [{ from: selFrom, to: selTo }],
    [{ from: 0, to: text.length }],
    (from, to) => {
      // from 所在行行首 + 之后 <=to 的所有行首
      const first = Math.max(...starts.filter((s) => s <= from))
      const out = [first]
      for (const s of starts) if (s > first && s <= to) out.push(s)
      return out
    },
    (f, t) => text.slice(f, t)
  )
}
