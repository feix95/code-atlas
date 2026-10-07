// CodeMirror 装配间(预览编辑锤):编辑器长什么样、会什么本事,全在这一处登记。
// 三大件:分色账翻译(colorsToDecorations/highlightField)、选区折算(selectionToRef)、
// 基础扩展(buildSourceExtensions)。分色与选区两本是纯账,node 自测直接驱动。
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension
} from '@codemirror/state'
import type { Text } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  drawSelection,
  keymap,
  lineNumbers,
  type DecorationSet
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
// 相对路径引 shared(不走 @shared 别名):node 自测直接驱动本文件,别名只活在 vite 里
import { HL_KINDS } from '../../../shared/highlight.ts'

// ── 一、分色账翻译:主进程 tree-sitter 的「行内段落账」→ CM 的装饰标记 ──
// 单位天然同构:两边都是 UTF-16 偏移,col 即行内偏移,0 换算(Q3 调研结论)。
// 换字时旧装饰跟着 RangeSet.map 自动挪位,新一版分色回来前先对付着用。

/** 换一版分色账的号令:dispatch({effects: setHighlight.of(colors)}) */
export const setHighlight = StateEffect.define<number[][][] | undefined>()

/** 单行字数闸:超过就只跳语法着色(超长行多是打包产物/单行 JSON,上色纯属白烧) */
const HL_LINE_MAX_CHARS = 5000

const markPool = new Map<string, Decoration>()
function markFor(kind: string): Decoration {
  let d = markPool.get(kind)
  if (!d) {
    d = Decoration.mark({ class: `tok-${kind}` })
    markPool.set(kind, d)
  }
  return d
}

/**
 * 段落账 → 装饰集(纯函数,自测覆盖)。colors[i] 是第 i+1 行的段:[起始列, 结束列, 角色编号]。
 * 越界段/不认得的角色一律剪掉 —— 化妆只许锦上添花,不许把字吃掉(同 renderColoredLine 口径)。
 */
export function colorsToDecorations(doc: Text, colors: number[][][] | undefined): DecorationSet {
  if (!colors) return Decoration.none
  const marks: { from: number; to: number; value: Decoration }[] = []
  const lineCount = Math.min(colors.length, doc.lines)
  for (let i = 0; i < lineCount; i++) {
    const line = doc.line(i + 1)
    const segs = colors[i]
    if (!segs || line.length > HL_LINE_MAX_CHARS) continue
    for (const seg of segs) {
      const kind = HL_KINDS[seg[2]]
      if (!kind) continue
      const from = line.from + Math.max(0, Math.min(line.length, seg[0]))
      const to = line.from + Math.max(0, Math.min(line.length, seg[1]))
      if (to > from) marks.push({ from, to, value: markFor(kind) })
    }
  }
  return Decoration.set(marks, true)
}

/** 分色户口:doc 变了旧装饰自动挪位,接到 setHighlight 号令就整版换新 */
export const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlight)) return colorsToDecorations(tr.state.doc, e.value)
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})

// ── 二、选区折算:CM 选区位置 → 引用四要素(纯函数,自测覆盖)──
// 行号口径沿用旧选区账本:收尾正好顶在下一行行首、一个字没选中时,那一行不算进来。

export interface EditorSel {
  startLine: number
  endLine: number
  code: string
}

/** 光标(没选东西)、或只选中空白,回 null —— 没有可引用的东西 */
export function selectionToRef(doc: Text, from: number, to: number): EditorSel | null {
  if (from === to) return null
  const code = doc.sliceString(from, to)
  if (code.trim() === '') return null
  return {
    startLine: doc.lineAt(from).number,
    // to-1:收尾压行首时退到上一行尾巴,与旧「压行首不算」同口径
    endLine: doc.lineAt(to - 1).number,
    code
  }
}

// ── 三、基础扩展:编辑器自带的行号/撤销/选区/键位 + 本项目的钩子 ──

/** 折行开关的活动隔间:运行时切档不用重立编辑器,reconfigure 一把就够 */
export const wrapCompartment = new Compartment()

export interface SourceHooks {
  /** 文档有改动(打字/粘贴/撤销后):调用方拿去排自动保存 */
  onChanged: () => void
  /** 右键:返回 true = 菜单已开,别走浏览器默认;false = 没选东西不拦 */
  onContextMenu: (e: MouseEvent, view: EditorView) => boolean
  /** 选中段起拖:往 dataTransfer 塞引用载荷;返回 false 让 CM 自带的拖字逻辑继续 */
  onDragStart: (e: DragEvent, view: EditorView) => boolean
  /** Alt+Z 切自动换行(VS Code 同款键位):编辑器内也灵 */
  onToggleWrap: () => void
  /** Ctrl+S 立刻落盘(Obsidian 同款):自动保存照常管,按它只是催一笔提前 */
  onSaveNow: () => void
}

export function buildSourceExtensions(opts: { wrap: boolean; hooks: SourceHooks }): Extension[] {
  return [
    lineNumbers(),
    drawSelection(),
    history(),
    highlightField,
    wrapCompartment.of(opts.wrap ? EditorView.lineWrapping : []),
    keymap.of([
      { key: 'Alt-z', run: () => (opts.hooks.onToggleWrap(), true) },
      // Mod = Ctrl(Win/Linux)/Cmd(Mac):跟自动保存同一条写盘通道,按了催一笔
      { key: 'Mod-s', run: () => (opts.hooks.onSaveNow(), true) },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.hooks.onChanged()
    }),
    EditorView.domEventHandlers({
      contextmenu: (e, view) => opts.hooks.onContextMenu(e, view),
      dragstart: (e, view) => opts.hooks.onDragStart(e, view)
    }),
    EditorState.tabSize.of(2)
  ]
}
