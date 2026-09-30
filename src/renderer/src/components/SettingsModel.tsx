import { useEffect } from 'react'
import { DEFAULT_LMSTUDIO_BASE_URL } from '@shared/aiDefaults'
import type { ContextBill } from '@shared/contextBill'
import type { AiConfig, ModelFitVerdict } from '@shared/types'
import { TreeIcon } from './Icons'
import { CfgQ, CfgRow } from './CfgRow'
import { ModelShelfPanel } from './ModelShelfPanel.tsx'

/** 模型文件名的展示口径:全路径留在 data-tip 悬停里,行内只摆文件名 */
function fileBasename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/**
 * 「AI 设置」页的「模型」卡:AI 来源 + 随来源切换的连接配置
 * (内置:模型文件/模型货架/上下文窗口;LM Studio:服务地址/模型名)。
 * 货架做成遮罩弹层,收进卡内不再把整页顶长。
 */
export function SettingsModel({
  config,
  onConfigChange,
  isBuiltin,
  pickModel,
  shelfOpen,
  setShelfOpen,
  onShelfModelReady,
  modelPath,
  fitNote,
  models,
  modelsBusy,
  modelsNote,
  listModels,
  contextRaw,
  setContextRaw,
  onContextBlur,
  contextNotches,
  commitContextValue,
  ctxBill
}: {
  config: AiConfig | null
  onConfigChange: (next: AiConfig) => void
  isBuiltin: boolean
  pickModel: () => Promise<void>
  shelfOpen: boolean
  setShelfOpen: React.Dispatch<React.SetStateAction<boolean>>
  onShelfModelReady: () => void
  modelPath: string
  fitNote: ModelFitVerdict | null
  models: string[]
  modelsBusy: boolean
  modelsNote: string | null
  listModels: () => Promise<void>
  contextRaw: string
  setContextRaw: React.Dispatch<React.SetStateAction<string>>
  onContextBlur: () => void
  contextNotches: number[]
  commitContextValue: (v: number) => void
  ctxBill: ContextBill | null
}): React.JSX.Element {
  // Esc 收货架(遮罩点击在 JSX 里管)
  useEffect(() => {
    if (!shelfOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setShelfOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shelfOpen, setShelfOpen])

  const ctxSelectValue =
    contextRaw.trim() === ''
      ? 'auto'
      : contextNotches.includes(Number(contextRaw))
        ? contextRaw
        : '__custom'

  return (
    <>
      {!config ? (
        <CfgRow label="AI 来源" hint="读取配置中……">
          <span />
        </CfgRow>
      ) : (
        <>
          <CfgRow label="AI 来源" hint="设置 AI 模型的加载方式。">
            <select
              className="cfg-select"
              aria-label="AI 来源"
              value={isBuiltin ? 'builtin' : 'lmstudio'}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  provider: e.target.value === 'builtin' ? 'builtin' : 'lmstudio'
                })
              }
            >
              <option value="builtin">内置模型</option>
              <option value="lmstudio">LM Studio</option>
            </select>
          </CfgRow>
          {isBuiltin ? (
            <>
              <div className="cfg-divider" />
              <CfgRow label="模型文件" hint="本地推理使用的 GGUF 模型文件。">
                <div className="cfg-ctlcol">
                  <div className="cfg-file">
                    <span className="cfg-file-name" data-tip={modelPath.trim() || undefined}>
                      {modelPath.trim() ? fileBasename(modelPath) : '未选择'}
                    </span>
                    <button
                      type="button"
                      id="cfg-model-path"
                      className="cfg-btn"
                      onClick={() => void pickModel()}
                    >
                      浏览…
                    </button>
                  </div>
                  {modelPath.trim() && fitNote && fitNote.level === 'missing' && (
                    <p className="cfg-note is-missing">
                      ✕ {fitNote.title}：{fitNote.detail}
                    </p>
                  )}
                </div>
              </CfgRow>
              <div className="cfg-divider" />
              <CfgRow
                label={
                  <>
                    模型货架
                    <CfgQ tip="热门模型榜单；按机器规模筛选，可直接下载。" />
                  </>
                }
              >
                <button type="button" className="cfg-btn" onClick={() => setShelfOpen(true)}>
                  <TreeIcon name="sparkles" size={13} mono />
                  打开模型货架
                </button>
              </CfgRow>
              <div className="cfg-divider" />
              <CfgRow label="上下文窗口">
                <div className="cfg-ctlcol">
                  <div className="cfg-ctx">
                    <input
                      className="cfg-input cfg-ctx-input"
                      autoComplete="off"
                      inputMode="numeric"
                      value={contextRaw}
                      placeholder="留空自动探测"
                      aria-label="上下文窗口"
                      onChange={(e) => {
                        // 第八十九锤:打字时只挡非数字,大小不拦 —— 夹紧挪到失焦/保存那一刻
                        setContextRaw(e.target.value.replace(/[^0-9]/g, ''))
                      }}
                      onBlur={onContextBlur}
                    />
                    <select
                      className="cfg-select"
                      aria-label="上下文预设"
                      value={ctxSelectValue}
                      onChange={(e) => {
                        if (e.target.value === 'auto') setContextRaw('')
                        else if (e.target.value !== '__custom')
                          commitContextValue(Number(e.target.value))
                      }}
                    >
                      <option value="auto">自动</option>
                      {contextNotches.map((n) => (
                        <option key={n} value={n}>
                          {n / 1024}k
                        </option>
                      ))}
                      {/* 手填的非档位值:下拉显示空白,不占选项位 */}
                      <option value="__custom" hidden />
                    </select>
                  </div>
                  {ctxBill && <p className={`cfg-note is-${ctxBill.level}`}>{ctxBill.text}</p>}
                </div>
              </CfgRow>
            </>
          ) : (
            <>
              <div className="cfg-divider" />
              <CfgRow
                label={
                  <>
                    服务地址
                    <CfgQ
                      tip={`代码将上传至该服务器；在 LM Studio 启用「开发者」服务，默认地址 ${DEFAULT_LMSTUDIO_BASE_URL}。`}
                    />
                  </>
                }
              >
                <input
                  className="cfg-input cfg-url-input"
                  value={config.lmstudio.baseUrl}
                  placeholder={DEFAULT_LMSTUDIO_BASE_URL}
                  spellCheck={false}
                  aria-label="服务地址"
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      lmstudio: { ...config.lmstudio, baseUrl: e.target.value }
                    })
                  }
                />
              </CfgRow>
              <div className="cfg-divider" />
              <CfgRow label="模型名" hint="从服务读取的模型列表中选择。">
                <div className="cfg-ctlcol">
                  <div className="cfg-file">
                    {models.length > 0 ? (
                      <select
                        className="cfg-select"
                        aria-label="模型名"
                        value={config.lmstudio.model}
                        onChange={(e) =>
                          onConfigChange({
                            ...config,
                            lmstudio: { ...config.lmstudio, model: e.target.value }
                          })
                        }
                      >
                        {models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                        {!models.includes(config.lmstudio.model) && (
                          <option value={config.lmstudio.model} hidden />
                        )}
                      </select>
                    ) : (
                      <input
                        className="cfg-input"
                        value={config.lmstudio.model}
                        placeholder="点「读取模型」自动填充"
                        spellCheck={false}
                        aria-label="模型名"
                        onChange={(e) =>
                          onConfigChange({
                            ...config,
                            lmstudio: { ...config.lmstudio, model: e.target.value }
                          })
                        }
                      />
                    )}
                    <button
                      type="button"
                      className="cfg-btn"
                      onClick={() => void listModels()}
                      disabled={modelsBusy}
                    >
                      {modelsBusy ? '连接中……' : '读取模型'}
                    </button>
                  </div>
                  {modelsNote && <p className="cfg-note is-warn">{modelsNote}</p>}
                </div>
              </CfgRow>
            </>
          )}
        </>
      )}
      {shelfOpen && (
        <div
          className="shelf-mask"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShelfOpen(false)
          }}
        >
          <div className="shelf-modal" role="dialog" aria-label="模型货架">
            <div className="shelf-modal-head">
              <b>模型货架</b>
              <button
                type="button"
                className="shelf-close"
                aria-label="关闭"
                onClick={() => setShelfOpen(false)}
              >
                <TreeIcon name="x" size={14} mono />
              </button>
            </div>
            <ModelShelfPanel onModelReady={onShelfModelReady} />
            <div className="shelf-modal-foot">
              榜单按社区热度排序；模型越大回答越聪明，也越吃显存。
            </div>
          </div>
        </div>
      )}
    </>
  )
}
