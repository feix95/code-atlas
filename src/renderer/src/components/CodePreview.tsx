import { useEffect, useMemo, useState } from 'react'
import type { FilePreviewResult, ScanFileNode } from '@shared/types'
import { friendlyErr } from '../errText'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'
import { TreeIcon } from './Icons'

/**
 * 代码预览(第一百一十锤):树上右键「预览文件」后,左栏从目录树换成这扇只读的文本窗。
 * 只摆纯文本 + 行号 —— 不描语法色(那是另一锤的事),看得清、选得中就行。
 * 正文只活在这个组件的 state 里:退出预览组件一卸,内容跟着就走,不留垃圾。
 * 不可预览的情况(二进制/超大/读不了)老实说明白,绝不硬塞一屏乱码。
 */
export function CodePreview({
  rootPath,
  file,
  onClose
}: {
  rootPath: string
  file: ScanFileNode
  onClose: () => void
}): React.JSX.Element {
  const [result, setResult] = useState<FilePreviewResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

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
          <div className="code-view">
            <pre className="code-gutter" aria-hidden="true">
              {gutter}
            </pre>
            <pre className="code-text">{text}</pre>
          </div>
        </>
      )}
    </div>
  )
}
