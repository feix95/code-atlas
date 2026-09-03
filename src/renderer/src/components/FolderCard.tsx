import { useState } from 'react'
import type { AiExplainResult } from '@shared/types'
import { friendlyErr } from '../errText'

// 文件夹讲解卡:把目录清单交给本地模型,讲「这个文件夹是负责什么的」。
// 路径契约由主进程保证,这里只递 (rootPath, relPath);relPath='' 表示项目根。
export function FolderCard({ rootPath, relPath, name }: { rootPath: string; relPath: string; name: string }): React.JSX.Element {
  const [result, setResult] = useState<AiExplainResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleExplain(): Promise<void> {
    setBusy(true)
    setResult(null)
    try {
      const res = await window.atlas.aiExplainFolder(rootPath, relPath)
      setResult(res)
    } catch (err) {
      setResult({ status: 'error', text: friendlyErr(err), model: '', durationMs: 0 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="structure">
      <div className="structure-head">
        <span className="structure-title">📁 {name}</span>
        {relPath === '' && <span className="structure-lang">项目根</span>}
      </div>
      <div className="explain">
        <div className="explain-head">
          <span className="explain-title">💬 这个文件夹是干嘛的</span>
          <button type="button" className="btn" onClick={handleExplain} disabled={busy}>
            {busy ? '⏳ 模型思考中……' : '🤖 用大白话讲讲'}
          </button>
        </div>
        {busy && <div className="explain-note">正在看这个文件夹里装了什么,组织人话……</div>}
        {!busy && result?.status === 'supported' && <div className="explain-text">✨ {result.text}</div>}
        {!busy && result?.status === 'unsupported' && <div className="explain-note">{result.text}</div>}
        {!busy && result?.status === 'error' && <div className="explain-note is-error">⚠️ {result.text}</div>}
      </div>
    </section>
  )
}
