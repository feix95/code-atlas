// 源码编辑器(预览编辑锤·锤2):所有文本文件的源码档 = 一台 CodeMirror 6 编辑器。
// 只管一件事:把文件摊开给你改,停手 1 秒自动落盘。
// 分色用主进程 tree-sitter 的老账(换字先让旧色跟着挪,存盘后重算换新);
// 选区引用/直拖沿用老规矩,右键菜单同一份;跳行/折行/文档缩放照吃老开关。
import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { ChatCodeRef } from '@shared/types'
import { CODE_REF_CHARS_MAX } from '@shared/aiDefaults'
import { DRAG_MIME_REF, type DragRefPayload } from '@shared/dragTypes'
import { friendlyErr } from '../errText'
import { refButtonLabel } from '../selectionMarks'
import { openContextMenu, type ContextMenuItem } from './contextMenuStore'
import {
  buildSourceExtensions,
  selectionToRef,
  setHighlight,
  wrapCompartment
} from '../editor/cmSetup'

/** 停手多久自动落盘(小葵拍板:约 1 秒防抖) */
const AUTOSAVE_MS = 1000
/** 存盘失败后的缓行重试间隔(文件被临时占用这类缓一会儿自己能好) */
const RETRY_MS = 5000
/** 自动重试上限:到顶就歇着等下次编辑,别为一把死锁空转 */
const RETRY_MAX = 2

export function SourceEditor({
  rootPath,
  relPath,
  initialText,
  initialColors,
  wrap,
  canAddRef,
  refLimit,
  onAddRef,
  onTextChange,
  onToggleWrap,
  jump
}: {
  rootPath: string
  relPath: string
  /** 打开时的正文(readPreview 来的,行尾已归一为 LF) */
  initialText: string
  /** 打开时的分色账(可缺,缺了白字) */
  initialColors?: number[][][]
  wrap: boolean
  canAddRef: boolean
  refLimit: number
  onAddRef: (ref: ChatCodeRef) => void
  /** 正文一动就报一声:切阅读档要用最新文稿渲染(走 ref,不惹重渲) */
  onTextChange: (text: string) => void
  /** 编辑内的 Alt+Z 扳动折行:跟页头那颗钮走同一个开关 */
  onToggleWrap: () => void
  jump?: { line: number; seq: number } | null
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  /** 最新 props 的活口:编辑器内部回调身份不变,永远读最新一份 */
  const propsRef = useRef({
    rootPath,
    relPath,
    canAddRef,
    refLimit,
    onAddRef,
    onTextChange,
    onToggleWrap
  })
  useEffect(() => {
    propsRef.current = {
      rootPath,
      relPath,
      canAddRef,
      refLimit,
      onAddRef,
      onTextChange,
      onToggleWrap
    }
  })

  // ── 编辑器本体:一挂立一台,一卸收一台 ──
  // (relPath 变 = 换文件,父组件用 key={relPath} 强制重挂,这台编辑器一辈子只伺候一份文件)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let dirty = false
    /** 在路上的那笔保存:收摊时拿它串行接尾班,保证最后文稿盖过中间稿 */
    let inFlight: Promise<void> | null = null
    let retries = 0
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const refreshColors = (): void => {
      const view = viewRef.current
      if (!view) return
      window.atlas
        .readPreview(propsRef.current.rootPath, propsRef.current.relPath)
        .then((res) => {
          // 文稿还跟盘上对得上才换色 —— 对不上说明手里有未存的改动,旧色留着更准
          if (view.state.doc.toString() === res.text) {
            view.dispatch({
              effects: setHighlight.of(res.status === 'ok' ? res.colors : undefined)
            })
          }
        })
        .catch(() => {
          /* 分色没刷成不碍事,旧色照旧 */
        })
    }

    const arm = (ms: number): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void save(), ms)
    }

    const save = async (): Promise<void> => {
      const view = viewRef.current
      if (!view || !dirty || inFlight) return
      const doc = view.state.doc
      propsRef.current.onTextChange(doc.toString())
      inFlight = (async () => {
        try {
          await window.atlas.saveFile(
            propsRef.current.rootPath,
            propsRef.current.relPath,
            doc.toString()
          )
          setSaveErr(null)
          retries = 0
          if (view.state.doc === doc) dirty = false // 存盘期间又打了字 = 还脏,接着排
          refreshColors()
        } catch (e) {
          setSaveErr(`自动保存没写进去:${friendlyErr(e)} —— 改动还在,继续编辑会再试`)
          retries += 1
        } finally {
          inFlight = null
          // 还脏就再排一班:存盘期间打字(AUTOSAVE)、写砸了(RETRY 缓行,到顶歇着等下一键)
          if (dirty && !disposed && retries <= RETRY_MAX) {
            arm(retries === 0 ? AUTOSAVE_MS : RETRY_MS)
          }
        }
      })()
    }

    const schedule = (): void => {
      retries = 0
      arm(AUTOSAVE_MS)
    }

    const quoteSelection = (view: EditorView): void => {
      const p = propsRef.current
      const sel = selectionToRef(
        view.state.doc,
        view.state.selection.main.from,
        view.state.selection.main.to
      )
      if (!sel) return
      p.onAddRef({ relPath: p.relPath, ...sel })
      view.dispatch({ selection: { anchor: view.state.selection.main.to } })
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialText,
        extensions: buildSourceExtensions({
          wrap,
          hooks: {
            onChanged: () => {
              dirty = true
              schedule()
            },
            onContextMenu: (e, view) => {
              const p = propsRef.current
              const sel = selectionToRef(
                view.state.doc,
                view.state.selection.main.from,
                view.state.selection.main.to
              )
              if (!sel) return false // 右键没点在选区上:不拦、不摆空菜单
              e.preventDefault()
              const items: ContextMenuItem[] = []
              if (p.refLimit > 0) {
                items.push({
                  label: refButtonLabel({
                    canAddRef: p.canAddRef,
                    refLimit: p.refLimit,
                    charCap: CODE_REF_CHARS_MAX,
                    startLine: sel.startLine,
                    endLine: sel.endLine,
                    charCount: sel.code.length
                  }),
                  disabled: !p.canAddRef,
                  run: () => quoteSelection(view)
                })
              }
              items.push({
                label: '复制选中段',
                run: () =>
                  navigator.clipboard
                    .writeText(sel.code)
                    .then(() => '已复制 ✓')
                    .catch(() => '没复制成,剪贴板被顶住了')
              })
              openContextMenu({
                x: e.clientX,
                y: e.clientY,
                doc: view.dom.ownerDocument,
                items
              })
              return true
            },
            onDragStart: (e, view) => {
              const p = propsRef.current
              if (p.refLimit === 0) return false
              const sel = selectionToRef(
                view.state.doc,
                view.state.selection.main.from,
                view.state.selection.main.to
              )
              if (!sel || !e.dataTransfer) return false
              const ref: DragRefPayload = { relPath: p.relPath, ...sel }
              e.dataTransfer.setData(DRAG_MIME_REF, JSON.stringify(ref))
              return false // 字本身的拖拽归 CM 管,咱只搭车塞暗号
            },
            onToggleWrap: () => propsRef.current.onToggleWrap(),
            // Ctrl+S:把等着的防抖掐掉,自动保存立刻来一笔(在路上时按了也不慌,尾班接着排)
            onSaveNow: () => {
              if (timer) {
                clearTimeout(timer)
                timer = null
              }
              void save()
            }
          }
        })
      })
    })
    viewRef.current = view
    if (initialColors) view.dispatch({ effects: setHighlight.of(initialColors) })
    // 挂载即校一次分色:重开签/切档回来时,盘上的文稿和手里一致就给最新色
    refreshColors()

    /** 尾班落盘:收摊/关窗前的最后一笔 —— 有在路的就串行接尾(最终稿盖过中间稿),没有在路的直接写 */
    const flush = (): void => {
      if (!dirty) return
      const p = propsRef.current
      const text = view.state.doc.toString()
      p.onTextChange(text)
      const write = (): Promise<unknown> => window.atlas.saveFile(p.rootPath, p.relPath, text)
      void (inFlight ? inFlight.finally(write) : write())
      dirty = false
    }
    // 关窗兜底:组件可能来不及卸,窗先没了 —— invoke 已发出的瞬间主进程就接了活,
    // 渲染层死不死都不耽误落盘
    const onBeforeUnload = (): void => flush()
    const owner = host.ownerDocument.defaultView ?? window
    owner.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      disposed = true
      owner.removeEventListener('beforeunload', onBeforeUnload)
      if (timer) clearTimeout(timer)
      flush() // 签关/切档 = 最后一把落盘
      view.destroy()
      viewRef.current = null
    }
    // initialText/initialColors 只在出生那一刻用一次;后续正文归编辑器自己管
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 折行开关换档:隔间重配,编辑器不用重立
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : [])
    })
  }, [wrap])

  // 跳行:聊天文件链接点的 —— 行号夹到文件边缘,落到视口中央
  useEffect(() => {
    const view = viewRef.current
    if (!view || !jump) return
    const line = Math.min(Math.max(jump.line, 1), view.state.doc.lines)
    const pos = view.state.doc.line(line).from
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' })
    })
  }, [jump])

  return (
    <div className="cm-host" ref={hostRef} aria-label={`${relPath} 的源码编辑器,改动会自动保存`}>
      {saveErr && <p className="code-pane-note is-warn">{saveErr}</p>}
    </div>
  )
}
