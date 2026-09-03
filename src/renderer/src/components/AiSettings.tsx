import { useEffect, useState } from 'react'
import type { AiConfig } from '@shared/types'

// AI 设置:连本地 LM Studio,读取并选择模型。改了就存,下次不用再配。
export function AiSettings(): React.JSX.Element {
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.atlas.aiConfigGet().then(setConfig).catch((err) => setNote(String(err)))
  }, [])

  async function handleListModels(): Promise<void> {
    if (!config) return
    setBusy(true)
    setNote(null)
    setModels([])
    try {
      const ids = await window.atlas.aiListModels(config.baseUrl)
      setModels(ids)
      if (ids.length === 0) setNote('LM Studio 通了,但没列出模型。加载一个模型再试。')
    } catch (err) {
      setNote(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(): Promise<void> {
    if (!config) return
    setBusy(true)
    setNote(null)
    try {
      const saved = await window.atlas.aiConfigSave(config)
      setConfig(saved)
      setNote('✅ 已保存')
    } catch (err) {
      setNote(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!config) {
    return <div className="structure-note">读取配置中……</div>
  }

  return (
    <div className="ai-settings">
      <div className="ai-field">
        <label className="ai-label" htmlFor="ai-baseurl">模型服务地址</label>
        <input
          id="ai-baseurl"
          className="ai-input"
          value={config.baseUrl}
          onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
          placeholder="http://127.0.0.1:1234/v1"
        />
        <p className="ai-hint">LM Studio 里点「开发者」标签,把本地服务器开着,地址一般是这个。</p>
      </div>

      <div className="ai-field">
        <label className="ai-label" htmlFor="ai-model">模型名</label>
        <input
          id="ai-model"
          className="ai-input"
          value={config.model}
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
          placeholder="点右侧「读取模型」自动填,或手动填"
        />
        <button type="button" className="btn" onClick={handleListModels} disabled={busy}>
          {busy ? '连接中……' : '📡 读取模型'}
        </button>
        {models.length > 0 && (
          <div className="ai-models">
            {models.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip chip-sm chip-link ${m === config.model ? 'is-on' : ''}`}
                onClick={() => setConfig({ ...config, model: m })}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ai-actions">
        <button type="button" className="btn" onClick={handleSave} disabled={busy}>
          {busy ? '保存中……' : '💾 保存'}
        </button>
        {note && <span className="ai-note">{note}</span>}
      </div>
    </div>
  )
}
