/**
 * Live Preview 装饰引擎(md 三档锤):
 * 同一份源码,光标不在的地方「上妆」成渲染效果,光标所在的语法块「卸妆」露源码 ——
 * 对标 Obsidian 的 Live Preview。
 *
 * 管线:lezer 语法树(@codemirror/lang-markdown 的 markdown() 养着,cmSetup 挂进编辑器)
 *   → planLiveDecos() 逐节点翻译成「装饰清单」(纯函数,自测直接喂)
 *   → buildLiveDecos() 把清单转成 CM6 Decoration(藏记号 / 换行皮 / 整块换真渲染)
 * 所有花样都在装饰层,文档本身一个字符不动 —— 撤销、自动保存看到的永远是真源码。
 */
import { syntaxTree } from '@codemirror/language'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import type { Extension, Range } from '@codemirror/state'
import type { Tree, SyntaxNode } from '@lezer/common'
// 相对路径引 shared(不走 @shared 别名):node 自测直接驱动本文件,别名只活在 vite 里
import { parseMarkdown, type MdInline } from '../../../shared/markdown.ts'

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

/** ATX 标题:# ~ ######;下划线标题单独认(它的横线行要整行收摊) */
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

// ── 装饰清单 → CM6 Decoration ──

/** MdInline → DOM(表格单元格的内文用;MiniMD renderInline 的 DOM 版,同一套类名) */
function inlineToDom(nodes: MdInline[], doc: Document, host: HTMLElement): void {
  for (const n of nodes) {
    switch (n.t) {
      case 'bold': {
        const el = doc.createElement('strong')
        el.textContent = n.text
        host.appendChild(el)
        break
      }
      case 'em': {
        const el = doc.createElement('em')
        el.textContent = n.text
        host.appendChild(el)
        break
      }
      case 'del': {
        const el = doc.createElement('del')
        el.textContent = n.text
        host.appendChild(el)
        break
      }
      case 'mark': {
        const el = doc.createElement('mark')
        el.className = 'md-mark'
        el.textContent = n.text
        host.appendChild(el)
        break
      }
      case 'code': {
        const el = doc.createElement('code')
        el.textContent = n.text
        host.appendChild(el)
        break
      }
      case 'link': {
        const el = doc.createElement('span')
        el.className = 'md-link'
        el.dataset.tip = n.href
        el.textContent = n.label
        host.appendChild(el)
        break
      }
      default:
        host.appendChild(doc.createTextNode(n.text))
    }
  }
}

/** 无序列表记号替身:一颗小圆点 */
class BulletWidget extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof BulletWidget
  }
  toDOM(view: EditorView): HTMLElement {
    const el = view.dom.ownerDocument.createElement('span')
    el.className = 'cm-live-bullet'
    el.textContent = '•'
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** 待办复选框:点一下把文档里的 [ ] 改成 [x](真改字,自动保存照走) */
class CheckboxWidget extends WidgetType {
  readonly checked: boolean
  readonly from: number
  readonly to: number
  constructor(checked: boolean, from: number, to: number) {
    super()
    this.checked = checked
    this.from = from
    this.to = to
  }
  eq(other: WidgetType): boolean {
    return (
      other instanceof CheckboxWidget && other.checked === this.checked && other.from === this.from
    )
  }
  toDOM(view: EditorView): HTMLElement {
    const cb = view.dom.ownerDocument.createElement('input')
    cb.type = 'checkbox'
    cb.className = 'cm-live-task'
    cb.checked = this.checked
    // mousedown 拦在编辑器选区前面,不然点它先把光标拽走
    cb.onmousedown = (e) => e.preventDefault()
    cb.onclick = () =>
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' }
      })
    return cb
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** 分割线替身:一条真横线 */
class HrWidget extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof HrWidget
  }
  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument
    const box = doc.createElement('div')
    box.className = 'cm-live-hr'
    box.appendChild(doc.createElement('hr'))
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}

/**
 * 表格替身:源码段落整块换成 .md 同款真表格 ——
 * 解析走 shared/markdown.ts 的 parseMarkdown(和阅读档同一份 AST,长相天然一致);
 * 认不出表格(改了一半的烂摊)就退回等宽源码,不硬画。
 */
class TableWidget extends WidgetType {
  readonly src: string
  constructor(src: string) {
    super()
    this.src = src
  }
  eq(other: WidgetType): boolean {
    return other instanceof TableWidget && other.src === this.src
  }
  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument
    const box = doc.createElement('div')
    box.className = 'cm-live-table md'
    const tbl = parseMarkdown(this.src).find((b) => b.t === 'table')
    if (!tbl || tbl.t !== 'table') {
      const pre = doc.createElement('pre')
      pre.className = 'cm-live-table-raw'
      pre.textContent = this.src
      box.appendChild(pre)
      return box
    }
    const wrap = doc.createElement('div')
    wrap.className = 'md-table-wrap'
    const table = doc.createElement('table')
    table.className = 'md-table'
    const thead = doc.createElement('thead')
    const trh = doc.createElement('tr')
    tbl.head.forEach((cell, j) => {
      const th = doc.createElement('th')
      th.style.textAlign = tbl.aligns[j] ?? 'left'
      inlineToDom(cell, doc, th)
      trh.appendChild(th)
    })
    thead.appendChild(trh)
    table.appendChild(thead)
    const tbody = doc.createElement('tbody')
    for (const row of tbl.body) {
      const tr = doc.createElement('tr')
      row.forEach((cell, j) => {
        const td = doc.createElement('td')
        td.style.textAlign = tbl.aligns[j] ?? 'left'
        inlineToDom(cell, doc, td)
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    wrap.appendChild(table)
    box.appendChild(wrap)
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}

const bulletDeco = Decoration.replace({ widget: new BulletWidget() })
const hideDeco = Decoration.replace({})
const hrDeco = Decoration.replace({ widget: new HrWidget(), block: true })
const markPool = new Map<string, Decoration>()
function clsMark(cls: string): Decoration {
  let d = markPool.get(cls)
  if (!d) {
    d = Decoration.mark({ class: cls })
    markPool.set(cls, d)
  }
  return d
}
const linePool = new Map<string, Decoration>()
function clsLine(cls: string): Decoration {
  let d = linePool.get(cls)
  if (!d) {
    d = Decoration.line({ attributes: { class: cls } })
    linePool.set(cls, d)
  }
  return d
}

/** 清单 → DecorationSet(Decoration.set 带 sort,清单乱序/重叠都收) */
export function liveDecoSet(
  items: readonly LiveDeco[],
  read: (from: number, to: number) => string
): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const it of items) {
    switch (it.t) {
      case 'line':
        if (it.cls !== '') ranges.push(clsLine(it.cls).range(it.from))
        break
      case 'hide':
        ranges.push(hideDeco.range(it.from, it.to))
        break
      case 'mark':
        ranges.push(clsMark(it.cls).range(it.from, it.to))
        break
      case 'bullet':
        ranges.push(bulletDeco.range(it.from, it.to))
        break
      case 'task':
        ranges.push(
          Decoration.replace({ widget: new CheckboxWidget(it.checked, it.from, it.to) }).range(
            it.from,
            it.to
          )
        )
        break
      case 'hr':
        ranges.push(hrDeco.range(it.from, it.to))
        break
      case 'table':
        ranges.push(
          Decoration.replace({ widget: new TableWidget(read(it.from, it.to)), block: true }).range(
            it.from,
            it.to
          )
        )
        break
    }
  }
  return Decoration.set(ranges, true)
}

/** 编辑器侧组装:可见区 → 清单 → 装饰集 */
function buildLiveDecos(view: EditorView): DecorationSet {
  const doc = view.state.doc
  return liveDecoSet(
    planLiveDecos(
      syntaxTree(view.state),
      view.state.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
      view.visibleRanges,
      (from, to) => {
        const a = doc.lineAt(from).number
        const b = doc.lineAt(to).number
        const starts: number[] = []
        for (let i = a; i <= b; i++) starts.push(doc.line(i).from)
        return starts
      },
      (f, t) => view.state.sliceDoc(f, t)
    ),
    (f, t) => view.state.sliceDoc(f, t)
  )
}

/**
 * Live Preview 扩展(cmSetup 里 markdown() 之后挂):
 * 装饰集跟着 文档变化/选区移动/视口滚动/语法树长齐 重算 ——
 * 换字挪选区只重贴可见区一份清单,整份文档绝不重扫。
 */
export const livePreview: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildLiveDecos(view)
    }
    update(u: ViewUpdate): void {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        syntaxTree(u.state) !== syntaxTree(u.startState)
      ) {
        this.decorations = buildLiveDecos(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

/** 自测专用:纯 node 环境下给一段 md 算出装饰清单(编辑器同款 livePlanDecos 入口) */
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
