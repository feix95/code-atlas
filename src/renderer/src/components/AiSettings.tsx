import { useEffect, useRef, useState } from 'react'
import type { AiConfig } from '@shared/types'
import { friendlyErr } from '../errText'
import { Notice } from './Notice'

// 信号灯口径:提示语分两色 —— 真出错的(friendlyErr)挂红,随口一说挂灰
type Note = { text: string; kind: 'info' | 'error' }

/**
 * AI 设置:选 AI 从哪儿来 —— LM Studio(外部服务)或 内置模型(本机 llama-server)。
 * 跟外观设置一个路数:改了就存,没有「保存」按钮 ——
 * 离散改动(切 Provider、选模型、联网开关)点一下立刻存;
 * 手打的文本框(地址/模型名/模型路径)失焦才存,不打断打字也不会把半截内容写盘。
 */
export function AiSettings(): React.JSX.Element {
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [note, setNote] = useState<Note | null>(null)
  const [busy, setBusy] = useState(false)
  // 最近一次落盘的配置快照:失焦存档前对一眼,没变就不白写一次盘
  const lastSavedRef = useRef<string>('')

  useEffect(() => {
    void window.atlas.aiConfigGet()
      .then((saved) => {
        setConfig(saved)
        lastSavedRef.current = JSON.stringify(saved)
      })
      .catch((err) => setNote({ text: friendlyErr(err), kind: 'error' }))
  }, [])

  /** 存档并汇报:成功挂一句「已保存」,失败挂红。配置主体不动,存的是传进来的这份 */
  async function persist(next: AiConfig): Promise<void> {
    if (JSON.stringify(next) === lastSavedRef.current) return // 没变化,不白存
    setBusy(true)
    setNote(null)
    try {
      const saved = await window.atlas.aiConfigSave(next)
      lastSavedRef.current = JSON.stringify(saved)
      setConfig(saved)
      setNote({ text: '✅ 已保存', kind: 'info' })
    } catch (err) {
      setNote({ text: friendlyErr(err), kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  /** 离散改动:点一下就存 */
  function apply(next: AiConfig): void {
    setConfig(next)
    void persist(next)
  }

  /** 文本框失焦:把手头这份存掉(没改动会被 persist 里的快照比对拦下) */
  function saveOnBlur(): void {
    if (config) void persist(config)
  }

  async function handleListModels(): Promise<void> {
    if (!config) return
    setBusy(true)
    setNote(null)
    setModels([])
    try {
      const ids = await window.atlas.aiListModels(config.lmstudio.baseUrl)
      setModels(ids)
      if (ids.length === 0) setNote({ text: 'LM Studio 通了,但没列出模型。加载一个模型再试。', kind: 'info' })
    } catch (err) {
      setNote({ text: friendlyErr(err), kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function handlePick(): Promise<void> {
    if (!config) return
    setNote(null)
    try {
      const picked = await window.atlas.aiPickFile()
      if (!picked) return // 用户点了取消,不算事儿
      apply({ ...config, builtin: { ...config.builtin, modelPath: picked } })
    } catch (err) {
      setNote({ text: friendlyErr(err), kind: 'error' })
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
            onClick={() => apply({ ...config, provider: 'lmstudio' })}
          >
            🖥️ LM Studio(外部服务)
          </button>
          <button
            type="button"
            className={`chip chip-link ${isBuiltin ? 'is-on' : ''}`}
            onClick={() => apply({ ...config, provider: 'builtin' })}
          >
            🦙 内置模型(本机直跑)
          </button>
        </div>
        <p className="ai-hint">
          {isBuiltin
            ? '内置模式:选一个模型文件就能用。第一次点 AI 会自动启动(大模型加载要等一会儿),退出应用自动关闭。'
            : 'LM Studio 模式:先打开 LM Studio 并加载好模型,CodeAtlas 跟它对话。'}
        </p>
      </div>

      {/* 联网查证:默认关,本地优先是产品的根;开了也只发名字,不发路径 */}
      <div className="ai-field">
        <span className="ai-label">联网查证(默认关)</span>
        <div className="ai-providers">
          <button
            type="button"
            className={`chip chip-link ${config.webLookup ? 'is-on' : ''}`}
            onClick={() => apply({ ...config, webLookup: !config.webLookup })}
          >
            {config.webLookup ? '✅ 认不出来时允许联网查一下' : '⛔ 保持完全离线(默认)'}
          </button>
        </div>
        <p className="ai-hint">
          开了之后,讲解认不出某个文件夹/文件是谁家软件时,允许联网查一下再回答(需要联网)。
          只会把认不出的「名字」发出去查,不会传你的文件夹路径和别的文件;查不到就还用本地推测。点了马上生效。
        </p>
      </div>

      {isBuiltin ? (
        <div className="ai-field">
          <label className="ai-label" htmlFor="ai-model-path">模型文件</label>
          <div className="ai-row">
            <input
              id="ai-model-path"
              className="ai-input"
              value={config.builtin.modelPath}
              onChange={(e) => setConfig({ ...config, builtin: { ...config.builtin, modelPath: e.target.value } })}
              onBlur={saveOnBlur}
              placeholder="例如 D:\\models\\my-model.gguf"
            />
            <button type="button" className="btn" onClick={() => void handlePick()} disabled={busy}>
              📂 选择模型
            </button>
          </div>
          <p className="ai-hint">模型就是 AI 的大脑,一个独立文件。推理引擎已经内置在应用里,不用你操心;以后想换更强的 AI,换个模型文件就行。手改路径的话,点别处就自动保存。</p>
        </div>
      ) : (
        <>
          <div className="ai-field">
            <label className="ai-label" htmlFor="ai-baseurl">模型服务地址</label>
            <input
              id="ai-baseurl"
              className="ai-input"
              value={config.lmstudio.baseUrl}
              onChange={(e) => setConfig({ ...config, lmstudio: { ...config.lmstudio, baseUrl: e.target.value } })}
              onBlur={saveOnBlur}
              placeholder="http://127.0.0.1:1234/v1"
            />
            <p className="ai-hint">LM Studio 里点「开发者」标签,把本地服务器开着,地址一般是这个。填完点别处就自动保存。</p>
          </div>

          <div className="ai-field">
            <label className="ai-label" htmlFor="ai-model">模型名</label>
            <input
              id="ai-model"
              className="ai-input"
              value={config.lmstudio.model}
              onChange={(e) => setConfig({ ...config, lmstudio: { ...config.lmstudio, model: e.target.value } })}
              onBlur={saveOnBlur}
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
                    onClick={() => apply({ ...config, lmstudio: { ...config.lmstudio, model: m } })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {note && <Notice kind={note.kind}>{note.kind === 'error' ? `⚠️ ${note.text}` : note.text}</Notice>}
    </div>
  )
}
