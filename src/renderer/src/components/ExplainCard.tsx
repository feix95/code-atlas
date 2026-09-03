import { useState } from 'react'
import type { AiExplainResult } from '@shared/types'
import { friendlyErr } from '../errText'

// 人话解释卡:点「用大白话解释」→ 调本地模型 → 贴结果。路径契约由主进程保证,这里只递 relPath。
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

  async function handleExplain(): Promise<void> {
    setBusy(true)
    setResult(null)
    try {
      const res = await window.atlas.aiExplainFile(rootPath, relPath, languageId)
      setResult(res)
    } catch (err) {
      setResult({ status: 'error', text: friendlyErr(err), model: '', durationMs: 0 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="explain">
      <div className="explain-head">
        <span className="explain-title">💬 人话解释</span>
        <button type="button" className="btn" onClick={handleExplain} disabled={busy}>
          {busy ? '⏳ 模型思考中……' : '🤖 用大白话解释'}
        </button>
      </div>

      {busy && <div className="explain-note">正在把代码翻译成人话……(第一次可能慢,模型要加载)</div>}
      {!busy && result?.status === 'supported' && (
        <div className="explain-text">✨ {result.text}</div>
      )}
      {!busy && result?.status === 'unsupported' && (
        <div className="explain-note">{result.text}</div>
      )}
      {!busy && result?.status === 'error' && (
        <div className="explain-note is-error">⚠️ {result.text}</div>
      )}
    </div>
  )
}
