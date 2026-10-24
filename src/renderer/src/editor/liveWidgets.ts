/**
 * Live Preview 的替身控件:小圆点 / 真复选框 / 横线 / 内联标题。
 * 全是装饰层的假货,文档本身一个字不改;点它们只把编辑器光标摁回对应源码位置。
 */
import { WidgetType, type EditorView } from '@codemirror/view'
import { Facet } from '@codemirror/state'
// 相对路径引 shared(不走 @shared 别名):node 自测直接驱动本层,别名只活在 vite 里
import type { RenameOutcome } from '../../../shared/fileRename.ts'

/**
 * 块替身的统一敲门砖(ignoreEvent 案):替身挂了 ignoreEvent,编辑器对它身上的
 * 鼠标事件一概装瞎 —— 单击落不进光标,拖出的蓝底是浏览器原生选中(跟编辑器选区
 * 两本账,小葵踩过的坑)。修法:mousedown 拦掉原生选中,把编辑器光标摁进源码块
 * 再夺回焦点;选区一进块,装饰重算自然卸妆(Obsidian 同款手感)。
 */
export function revealAt(view: EditorView, from: number): (e: MouseEvent) => void {
  return (e) => {
    e.preventDefault()
    view.dispatch({ selection: { anchor: from } })
    view.focus()
  }
}

/** 无序列表记号替身:一颗小圆点(点它卸妆露回 - 记号) */
export class BulletWidget extends WidgetType {
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
export class CheckboxWidget extends WidgetType {
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
export class HrWidget extends WidgetType {
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

/** live 档的内联标题登记(cmSetup 装配时喂文件名,缺省 '' = 不摆) */
export const liveTitle = Facet.define<string, string>({ combine: (v) => v[0] ?? '' })

/** live 档的标题改名通道:cmSetup 喂回调,缺省 = 标题只展示不可改 */
export const liveRename = Facet.define<
  ((base: string) => Promise<RenameOutcome>) | undefined,
  ((base: string) => Promise<RenameOutcome>) | undefined
>({ combine: (v) => v[0] })

/**
 * 内联标题替身(Obsidian inline title):文档首行之上摆文件名,吃 .md-title 皮。
 * 接了改名通道时点击原地变输入框 —— Enter/失焦提交,Esc 取消;
 * 输入框吃标题同一身皮(.md-title-input),只露一条功能色底线。
 */
export class TitleWidget extends WidgetType {
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
        // 取消/失败:退回大字;成功则登记换账、编辑器重挂,这里不用还原
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
