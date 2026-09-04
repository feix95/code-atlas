import { useEffect, useRef, useState } from 'react'
import type { AiExplainResult } from '@shared/types'
import { friendlyErr } from '../errText'
import { Notice } from './Notice'

/** 掐掉还在路上的生成:换了目标/关了卡片时喊一声,模型立刻空出来讲下一个 */
function cancelExplain(id: string): void {
  if (id) void window.atlas.aiCancel(id)
}

// 人话解释卡:选中文件自动开讲(不用再点按钮),「再讲一次」可以重问;流式贴结果(边生成边显示)。
// 路径契约由主进程保证,这里只递 relPath;每次请求带 id,流式增量按 id 对号入座。
export function ExplainCard({
  rootPath,
  relPath,
  languageId
}: {
  rootPath: string
  relPath: string
  languageId: string
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
      const res = await window.atlas.aiExplainFile(rootPath, relPath, languageId, requestId)
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
    <div className="explain">
      <div className="explain-head">
        <span className="explain-title">💬 人话解释</span>
        <button type="button" className="btn" onClick={() => void run()} disabled={busy}>
          {busy ? '⏳ 模型思考中……' : result ? '🔄 再讲一次' : '🤖 用大白话解释'}
        </button>
      </div>

      {busy && (streamText ? (
        <div className="explain-text">✨ {streamText}<span className="stream-caret">▌</span></div>
      ) : (
        <div className="explain-note">正在把代码翻译成人话……(第一次可能慢,模型要热身)</div>
      ))}
      {!busy && result?.status === 'supported' && (
        <div className="explain-text">✨ {result.text}</div>
      )}
      {!busy && result?.status === 'unsupported' && <Notice kind="info">{result.text}</Notice>}
      {!busy && result?.status === 'error' && (
        <Notice kind="error">⚠️ {result.text}</Notice>
      )}
    </div>
  )
}
