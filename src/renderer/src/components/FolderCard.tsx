import { useEffect, useRef, useState } from 'react'
import type { AiExplainResult } from '@shared/types'
import { friendlyErr } from '../errText'

/** 掐掉还在路上的生成:换了目标/关了卡片时喊一声,模型立刻空出来讲下一个 */
function cancelExplain(id: string): void {
  if (id) void window.atlas.aiCancel(id)
}

// 文件夹讲解卡:选中文件夹自动开讲(不用再点按钮),「再讲一次」可以重问;流式显示。
// 路径契约由主进程保证,这里只递 (rootPath, relPath);relPath='' 表示项目根。
export function FolderCard({
  rootPath,
  relPath,
  name,
  onClose
}: {
  rootPath: string
  relPath: string
  name: string
  onClose?: () => void
}): React.JSX.Element {
  const [result, setResult] = useState<AiExplainResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [streamText, setStreamText] = useState('')
  const idRef = useRef('')

  const run = async (): Promise<void> => {
    cancelExplain(idRef.current)
    const requestId = crypto.randomUUID()
    idRef.current = requestId
    setBusy(true)
    setResult(null)
    setStreamText('')
    try {
      const res = await window.atlas.aiExplainFolder(rootPath, relPath, requestId)
      if (idRef.current !== requestId) return // 中途换人,这份旧账作废
      setResult(res)
    } catch (err) {
      if (idRef.current !== requestId) return
      setResult({ status: 'error', text: friendlyErr(err), model: '', durationMs: 0 })
    } finally {
      if (idRef.current === requestId) setBusy(false)
    }
  }

  // 选中即开讲:挂载就发起(调度到下一个 tick,不在挂载同一拍里改状态);
  // 卸载(换选中/关卡片)把还在生成的掐掉。StrictMode 双挂载时第一遍的定时器被清掉,只发一次请求
  useEffect(() => {
    const timer = setTimeout(() => void run(), 0)
    return () => {
      clearTimeout(timer)
      cancelExplain(idRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="structure">
      <div className="structure-head">
        <span className="structure-title">📁 {name}</span>
        {relPath === '' && <span className="structure-lang">项目根</span>}
        {onClose && (
          <button type="button" className="structure-close" onClick={onClose} title="关掉这张卡">
            ✕
          </button>
        )}
      </div>
      <div className="explain">
        <div className="explain-head">
          <span className="explain-title">💬 这个文件夹是干嘛的</span>
          <button type="button" className="btn" onClick={() => void run()} disabled={busy}>
            {busy ? '⏳ 模型思考中……' : result ? '🔄 再讲一次' : '🤖 用大白话讲讲'}
          </button>
        </div>
        {busy && (streamText ? (
          <div className="explain-text">✨ {streamText}<span className="stream-caret">▌</span></div>
        ) : (
          <div className="explain-note">正在等本地模型看完这个文件夹、组织人话(第一次要热身,可能得等一会儿)……</div>
        ))}
        {!busy && result?.status === 'supported' && <div className="explain-text">✨ {result.text}</div>}
        {!busy && result?.status === 'unsupported' && <div className="explain-note">{result.text}</div>}
        {!busy && result?.status === 'error' && <div className="explain-note is-error">⚠️ {result.text}</div>}
      </div>
    </section>
  )
}
