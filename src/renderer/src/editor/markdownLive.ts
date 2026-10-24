/**
 * Live Preview 装饰引擎:
 * 同一份源码,光标不在的地方「上妆」成渲染效果,光标所在的语法块「卸妆」露源码 ——
 * 对标 Obsidian 的 Live Preview。
 *
 * 管线:lezer 语法树(@codemirror/lang-markdown 的 markdown() 养着,cmSetup 挂进编辑器)
 *   → planLiveDecos() 逐节点翻译成「装饰清单」(纯函数,自测直接喂;住在 livePlan)
 *   → buildLiveDecos() 把清单转成 CM6 Decoration(藏记号 / 换行皮 / 整块换真渲染)
 * 所有花样都在装饰层,文档本身一个字符不动 —— 撤销、自动保存看到的永远是真源码。
 * 本文件只管「清单 → 编辑器」的装配,替身控件住在 liveWidgets。
 */
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import type { EditorState, Extension, Range } from '@codemirror/state'
import { widgetFocus } from './liveFocus.ts'
import { TableWidget, tableModelFromSource } from './markdownTable.ts'
import { planLiveDecos } from './livePlan.ts'
import type { LiveDeco } from './livePlan.ts'
import {
  BulletWidget,
  CheckboxWidget,
  HrWidget,
  TitleWidget,
  liveTitle,
  revealAt
} from './liveWidgets.ts'

// 公共出口保持原样,调用方(cmSetup / 自测)不用改 import
export { planLiveDecos, planLiveDecosForText } from './livePlan.ts'
export type { LiveDeco, LiveRange } from './livePlan.ts'
export { liveRename, liveTitle } from './liveWidgets.ts'

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

/** 编辑器侧组装:整份文档 → 清单 → 装饰集(头上再叠一颗内联标题替身,有登记才摆) */
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
