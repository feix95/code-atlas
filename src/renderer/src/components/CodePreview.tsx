import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatCodeRef, FilePreviewResult, ScanFileNode } from '@shared/types'
import { friendlyErr } from '../errText'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'
import { TreeIcon } from './Icons'

/** 选区浮钮的落点:按钮以「选区上沿中点」为锚,往上抬一点,别压住选中的行 */
interface Selection {
  x: number
  y: number
  startLine: number
  endLine: number
  code: string
}

/** 数一段文本里有几个换行 —— 行号就是这么算出来的 */
function countNewlines(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++
  }
  return n
}

/**
 * 代码预览(第一百一十锤):树上右键「预览文件」后,左栏从目录树换成这扇只读的文本窗。
 * 只摆纯文本 + 行号 —— 不描语法色(那是另一锤的事),看得清、选得中就行。
 * 正文只活在这个组件的 state 里:退出预览组件一卸,内容跟着就走,不留垃圾。
 * 不可预览的情况(二进制/超大/读不了)老实说明白,绝不硬塞一屏乱码。
 * 第一百一十一锤:选中一段代码,选区上方冒出「引用到对话」,点了挂到右栏的输入框上。
 */
export function CodePreview({
  rootPath,
  file,
  canAddRef,
  refLimit,
  onAddRef,
  onClose
}: {
  rootPath: string
  file: ScanFileNode
  /** 引用额度还没用满(满了浮钮就说清楚,不装作没反应) */
  canAddRef: boolean
  /** 一轮最多引几段(跟主进程同一个数) */
  refLimit: number
  onAddRef: (ref: ChatCodeRef) => void
  onClose: () => void
}): React.JSX.Element {
  const [result, setResult] = useState<FilePreviewResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<Selection | null>(null)
  const codeTextRef = useRef<HTMLPreElement>(null)

  // 组件按 relPath 挂 key:换文件 = 重挂,旧文件的内容不会串到新文件头上
  useEffect(() => {
    let alive = true
    // 路径契约:renderer 只回传 (rootPath, relPath),绝对路径是主进程的事
    window.atlas
      .readPreview(rootPath, file.relPath)
      .then((res) => {
        if (alive) setResult(res)
      })
      .catch((e) => {
        if (alive) setErr(friendlyErr(e))
      })
    return () => {
      alive = false
    }
  }, [rootPath, file.relPath])

  const text = result?.status === 'ok' ? result.text : ''

  // 行号拼成一整段文本(一个节点),而不是两千个 span —— 大文件也不给 DOM 添堵
  const gutter = useMemo(() => {
    const count = text === '' ? 0 : text.split('\n').length
    return Array.from({ length: count }, (_, i) => String(i + 1)).join('\n')
  }, [text])

  // 选区一变就算一遍行号:只有选的是代码正文才算数(行号栏选中的东西不算引用)
  useEffect(() => {
    if (result?.status !== 'ok') return
    function onSelectionChange(): void {
      const el = codeTextRef.current
      const selection = window.getSelection()
      if (!el || !selection || selection.isCollapsed || selection.rangeCount === 0 || !el.contains(selection.anchorNode)) {
        setSel(null)
        return
      }
      const code = selection.toString()
      if (code.trim() === '') {
        setSel(null)
        return
      }
      const full = el.textContent ?? ''
      const anchor = selection.anchorOffset
      const focus = selection.focusOffset
      const start = Math.min(anchor, focus)
      const end = Math.max(anchor, focus)
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      setSel({
        x: rect.left + rect.width / 2,
        y: rect.top,
        startLine: countNewlines(full.slice(0, start)) + 1,
        // 收尾用 end-1:选区末尾正好压在下一行的行首时,别把没选的那一行算进来
        endLine: countNewlines(full.slice(0, Math.max(start, end - 1))) + 1,
        code
      })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [result])

  return (
    <div className="code-pane">
      <div className="code-pane-head">
        <span className="code-pane-icon" aria-hidden="true">
          <TreeIcon name={file.summary?.icon ?? 'file'} size={15} />
        </span>
        <span className="code-pane-name mono" title={file.relPath}>
          {file.relPath}
        </span>
        <button type="button" className="btn btn-ghost code-pane-exit" onClick={onClose}>
          退出预览
        </button>
      </div>
      {err && <Notice kind="error">{err}</Notice>}
      {!err && !result && (
        <div className="card-waiting">
          <ProgressDots />
          正在读文件……
        </div>
      )}
      {!err && result && result.status !== 'ok' && <p className="code-pane-note">{result.reason}</p>}
      {!err && result?.status === 'ok' && (
        <>
          {result.truncated && (
            <p className="code-pane-note is-warn">这个文件长,只载入了开头一段(共 {result.totalLines.toLocaleString('en-US')} 行)。</p>
          )}
          <div
            className="code-view"
            tabIndex={0}
            aria-label={`${file.relPath} 的内容预览,选中一段可以引用给小探针`}
            // 滚动时按钮算的视口坐标就跟不上了,干脆收起来,免得浮在错误的位置
            onScroll={() => setSel(null)}
          >
            <pre className="code-gutter" aria-hidden="true">
              {gutter}
            </pre>
            <pre className="code-text" ref={codeTextRef}>
              {text}
            </pre>
          </div>
        </>
      )}
      {sel && (
        <button
          type="button"
          className="code-select-btn"
          style={{ left: `${Math.round(sel.x)}px`, top: `${Math.round(sel.y)}px` }}
          disabled={!canAddRef}
          title={canAddRef ? '把选中的代码引用给小探针' : `一轮最多引用 ${refLimit} 段`}
          onClick={() => {
            onAddRef({ relPath: file.relPath, startLine: sel.startLine, endLine: sel.endLine, code: sel.code })
            window.getSelection()?.removeAllRanges()
            setSel(null)
          }}
        >
          {canAddRef ? `引用到对话(第 ${sel.startLine}-${sel.endLine} 行)` : `最多引用 ${refLimit} 段`}
        </button>
      )}
    </div>
  )
}
