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
import { Facet, StateEffect, StateField } from '@codemirror/state'
import type { EditorState, Extension, Range } from '@codemirror/state'
import type { Tree, SyntaxNode } from '@lezer/common'
import { widgetFocus } from './liveFocus.ts'
import { TableWidget, tableModelFromSource } from './markdownTable.ts'
// 相对路径引 shared(不走 @shared 别名):node 自测直接驱动本文件,别名只活在 vite 里
import type { RenameOutcome } from '../../../shared/fileRename.ts'

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

/**
 * 块替身的统一敲门砖(ignoreEvent 案):替身挂了 ignoreEvent,编辑器对它身上的
 * 鼠标事件一概装瞎 —— 单击落不进光标,拖出的蓝底是浏览器原生选中(跟编辑器选区
 * 两本账,小葵踩过的坑)。修法:mousedown 拦掉原生选中,把编辑器光标摁进源码块
 * 再夺回焦点;选区一进块,装饰重算自然卸妆(Obsidian 同款手感)。
 */
function revealAt(view: EditorView, from: number): (e: MouseEvent) => void {
  return (e) => {
    e.preventDefault()
    view.dispatch({ selection: { anchor: from } })
    view.focus()
  }
}

/** 无序列表记号替身:一颗小圆点(点它卸妆露回 - 记号) */
class BulletWidget extends WidgetType {
  readonly from: number
  constructor(from: number) {
    super()
    this.from = from
  }
  eq(other: WidgetType): boolean {
    return other instanceof BulletWidget && other.from === this.from
  }
  toDOM(view: EditorView): HTMLElement {
    const el = view.dom.ownerDocument.createElement('span')
    el.className = 'cm-live-bullet'
    el.textContent = '•'
    el.onmousedown = revealAt(view, this.from)
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

/** 分割线替身:一条真横线(点它卸妆露回 --- 源码行) */
class HrWidget extends WidgetType {
  readonly from: number
  constructor(from: number) {
    super()
    this.from = from
  }
  eq(other: WidgetType): boolean {
    return other instanceof HrWidget && other.from === this.from
  }
  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument
    const box = doc.createElement('div')
    box.className = 'cm-live-hr'
    box.appendChild(doc.createElement('hr'))
    box.onmousedown = revealAt(view, this.from)
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** live 档的内联标题户口(cmSetup 装配时喂文件名,缺省 '' = 不摆) */
export const liveTitle = Facet.define<string, string>({ combine: (v) => v[0] ?? '' })

/** live 档的标题改名通道(内联标题改名锤):cmSetup 喂回调,缺省 = 标题只展示不可改 */
export const liveRename = Facet.define<
  ((base: string) => Promise<RenameOutcome>) | undefined,
  ((base: string) => Promise<RenameOutcome>) | undefined
>({ combine: (v) => v[0] })

/**
 * 内联标题替身(Obsidian inline title):文档首行之上摆文件名,吃 .md-title 皮。
 * 接了改名通道时点击原地变输入框 —— Enter/失焦提交,Esc 取消;
 * 输入框吃标题同一身皮(.md-title-input),只露一条功能色底线。
 */
class TitleWidget extends WidgetType {
  readonly title: string
  constructor(title: string) {
    super()
    this.title = title
  }
  eq(other: WidgetType): boolean {
    return other instanceof TitleWidget && other.title === this.title
  }
  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument
    const el = doc.createElement('div')
    el.className = 'md-title'
    el.textContent = this.title
    const rename = view.state.facet(liveRename)
    if (!rename) {
      // 没接改名通道:点它把光标带回文档头(点着有反应,不装瞎)
      el.onmousedown = revealAt(view, 0)
      return el
    }
    el.style.cursor = 'text'
    const title = this.title
    /** 提交只跑一次:disabled 触发的 blur、连按的 Enter,都靠这道闸挡住 */
    let done = false
    el.onmousedown = (e) => {
      if (e.target !== el) return // 点在输入框上,归输入框自己管
      e.preventDefault()
      if (done) return
      el.textContent = ''
      const input = doc.createElement('input')
      input.className = 'md-title-input'
      input.value = title
      input.setAttribute('aria-label', '新文件名(不含扩展名)')
      el.appendChild(input)
      input.focus()
      input.select()
      const commit = async (cancel: boolean): Promise<void> => {
        if (done) return
        done = true
        const v = input.value.trim()
        let renamed = false
        if (!cancel && v !== '' && v !== title) {
          input.disabled = true
          renamed = (await rename(v)).ok
        }
        // 取消/失败:退回大字;成功则户口换账、编辑器重挂,这里不用还原
        if (!renamed) el.textContent = title
      }
      input.onkeydown = (ev) => {
        ev.stopPropagation() // 键位归输入框,不透给编辑器(ignoreEvent 之外的保险)
        if (ev.key === 'Enter') {
          ev.preventDefault()
          void commit(false)
        } else if (ev.key === 'Escape') {
          ev.preventDefault()
          void commit(true)
        }
      }
      input.onblur = () => void commit(false)
    }
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

const hideDeco = Decoration.replace({})
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
        ranges.push(Decoration.replace({ widget: new BulletWidget(it.from) }).range(it.from, it.to))
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
        ranges.push(
          Decoration.replace({ widget: new HrWidget(it.from), block: true }).range(it.from, it.to)
        )
        break
      case 'table': {
        // 解析不出的烂表不给替身,源码原样晾着(逃生口内置)
        const model = tableModelFromSource(read(it.from, it.to))
        if (!model) break
        ranges.push(
          Decoration.replace({
            widget: new TableWidget(model, it.from, revealAt),
            block: true
          }).range(it.from, it.to)
        )
        break
      }
    }
  }
  return Decoration.set(ranges, true)
}

/** 编辑器侧组装:整份文档 → 清单 → 装饰集(头上再叠一颗内联标题替身,有户口才摆) */
function buildLiveDecos(state: EditorState): DecorationSet {
  const doc = state.doc
  // 焦点在表格等块替身里时,编辑器选区是过期的旧光标,当作「光标不在任何块里」
  const selRanges = state.field(widgetFocus)
    ? []
    : state.selection.ranges.map((r) => ({ from: r.from, to: r.to }))
  const items = planLiveDecos(
    syntaxTree(state),
    selRanges,
    [{ from: 0, to: doc.length }],
    (from, to) => {
      const a = doc.lineAt(from).number
      const b = doc.lineAt(to).number
      const starts: number[] = []
      for (let i = a; i <= b; i++) starts.push(doc.line(i).from)
      return starts
    },
    (f, t) => state.sliceDoc(f, t)
  )
  const set = liveDecoSet(items, (f, t) => state.sliceDoc(f, t))
  const title = state.facet(liveTitle)
  if (!title) return set
  return set.update({
    add: [Decoration.widget({ widget: new TitleWidget(title), side: -1, block: true }).range(0)]
  })
}

/**
 * 后台解析完工的信号:超大 md 的语法树是分批长出来的,
 * 树每长一截插件就往这里敲一笔,驱动下面的 compute 重算一次装饰。
 */
const treeGrown = StateEffect.define<null>()
const treeGen = StateField.define<number>({
  create: () => 0,
  update: (v, tr) => tr.effects.reduce((n, e) => (e.is(treeGrown) ? n + 1 : n), v)
})

/**
 * Live Preview 扩展(cmSetup 里 markdown() 之后挂):
 * 块级装饰(表格/hr 整块换替身)不许走 ViewPlugin 出账(CM6 硬规矩,插件一报块装饰就崩),
 * 所以装饰集归 EditorView.decorations.compute 管 —— 跟着 文档/选区/解析进度 重算。
 * 代价:不再只贴可见区,每次整份文档过一遍清单(md 文件量级撑得住)。
 */
export const livePreview: Extension = [
  treeGen,
  widgetFocus,
  EditorView.decorations.compute(['doc', 'selection', treeGen, widgetFocus], (state) =>
    buildLiveDecos(state)
  ),
  // 语法树长了但没新编辑(后台解析完工)→ 微任务转一圈后敲信号重算;
  // 不许在 update 里直接 dispatch(CM6 禁 update 内开新事务),视图没了就当没看见
  ViewPlugin.fromClass(
    class {
      update(u: ViewUpdate): void {
        if (syntaxTree(u.state) !== syntaxTree(u.startState)) {
          const view = u.view
          setTimeout(() => {
            if (view.dom.isConnected) view.dispatch({ effects: treeGrown.of(null) })
          })
        }
      }
    }
  )
]

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
