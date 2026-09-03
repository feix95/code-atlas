import { useEffect, useState } from 'react'
import type { AiConfig } from '@shared/types'
import { friendlyErr } from '../errText'

// AI 设置:选 AI 从哪儿来 —— LM Studio(外部服务)或 内置模型(本机 llama-server)。
// 两个 Provider 的设置互不干扰,切换不丢;改了就存,下次不用再配。
export function AiSettings(): React.JSX.Element {
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.atlas.aiConfigGet().then(setConfig).catch((err) => setNote(friendlyErr(err)))
  }, [])

  async function handleListModels(): Promise<void> {
    if (!config) return
    setBusy(true)
    setNote(null)
    setModels([])
    try {
      const ids = await window.atlas.aiListModels(config.lmstudio.baseUrl)
      setModels(ids)
      if (ids.length === 0) setNote('LM Studio 通了,但没列出模型。加载一个模型再试。')
    } catch (err) {
      setNote(friendlyErr(err))
    } finally {
      setBusy(false)
    }
  }

  async function handlePick(kind: 'server' | 'model'): Promise<void> {
    if (!config) return
    setNote(null)
    try {
      const picked = await window.atlas.aiPickFile(kind)
      if (!picked) return // 用户点了取消,不算事儿
      setConfig(
        kind === 'server'
          ? { ...config, builtin: { ...config.builtin, serverPath: picked } }
          : { ...config, builtin: { ...config.builtin, modelPath: picked } }
      )
    } catch (err) {
      setNote(friendlyErr(err))
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
      setNote(friendlyErr(err))
    } finally {
      setBusy(false)
    }
  }

  if (!config) {
    return <div className="structure-note">读取配置中……</div>
  }

  const isBuiltin = config.provider === 'builtin'

  return (
    <div className="ai-settings">
      <div className="ai-field">
        <span className="ai-label">AI 从哪儿来</span>
        <div className="ai-providers">
          <button
            type="button"
            className={`chip chip-link ${!isBuiltin ? 'is-on' : ''}`}
            onClick={() => setConfig({ ...config, provider: 'lmstudio' })}
          >
            🖥️ LM Studio(外部服务)
          </button>
          <button
            type="button"
            className={`chip chip-link ${isBuiltin ? 'is-on' : ''}`}
            onClick={() => setConfig({ ...config, provider: 'builtin' })}
          >
            🦙 内置模型(本机直跑)
          </button>
        </div>
        <p className="ai-hint">
          {isBuiltin
            ? '内置模式:选好程序和模型文件就行。第一次用 AI 时自动在后台启动,退出应用自动关闭,不占开机资源。'
            : 'LM Studio 模式:先打开 LM Studio 并加载好模型,CodeAtlas 跟它对话。'}
        </p>
      </div>

      {isBuiltin ? (
        <>
          <div className="ai-field">
            <label className="ai-label" htmlFor="ai-server-path">llama-server 程序路径</label>
            <div className="ai-row">
              <input
                id="ai-server-path"
                className="ai-input"
                value={config.builtin.serverPath}
                onChange={(e) => setConfig({ ...config, builtin: { ...config.builtin, serverPath: e.target.value } })}
                placeholder="例如 D:\\tools\\llama-server.exe"
              />
              <button type="button" className="btn" onClick={() => void handlePick('server')} disabled={busy}>
                📂 选择程序
              </button>
            </div>
            <p className="ai-hint">llama.cpp 自带的 llama-server 可执行文件(下载解压后里面那个 exe)。</p>
          </div>

          <div className="ai-field">
            <label className="ai-label" htmlFor="ai-model-path">GGUF 模型文件路径</label>
            <div className="ai-row">
              <input
                id="ai-model-path"
                className="ai-input"
                value={config.builtin.modelPath}
                onChange={(e) => setConfig({ ...config, builtin: { ...config.builtin, modelPath: e.target.value } })}
                placeholder="例如 F:\\LLM_Models\\Qwen\\...\\模型名.gguf"
              />
              <button type="button" className="btn" onClick={() => void handlePick('model')} disabled={busy}>
                📂 选择模型
              </button>
            </div>
            <p className="ai-hint">模型以独立文件存在,不塞进应用里;再大的模型也只是硬盘上的一个文件。</p>
          </div>
        </>
      ) : (
        <>
          <div className="ai-field">
            <label className="ai-label" htmlFor="ai-baseurl">模型服务地址</label>
            <input
              id="ai-baseurl"
              className="ai-input"
              value={config.lmstudio.baseUrl}
              onChange={(e) => setConfig({ ...config, lmstudio: { ...config.lmstudio, baseUrl: e.target.value } })}
              placeholder="http://127.0.0.1:1234/v1"
            />
            <p className="ai-hint">LM Studio 里点「开发者」标签,把本地服务器开着,地址一般是这个。</p>
          </div>

          <div className="ai-field">
            <label className="ai-label" htmlFor="ai-model">模型名</label>
            <input
              id="ai-model"
              className="ai-input"
              value={config.lmstudio.model}
              onChange={(e) => setConfig({ ...config, lmstudio: { ...config.lmstudio, model: e.target.value } })}
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
                    className={`chip chip-sm chip-link ${m === config.lmstudio.model ? 'is-on' : ''}`}
                    onClick={() => setConfig({ ...config, lmstudio: { ...config.lmstudio, model: m } })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="ai-actions">
        <button type="button" className="btn" onClick={handleSave} disabled={busy}>
          {busy ? '保存中……' : '💾 保存'}
        </button>
        {note && <span className="ai-note">{note}</span>}
      </div>
    </div>
  )
}
