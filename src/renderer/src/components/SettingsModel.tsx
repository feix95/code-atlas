import { useEffect, useState } from 'react'
import { DEFAULT_LMSTUDIO_BASE_URL } from '@shared/aiDefaults'
import { PROVIDER_OPTIONS } from '@shared/aiSetup'
import type { ContextBill } from '@shared/contextBill'
import type { AiConfig, ModelFitVerdict } from '@shared/types'
import { TreeIcon } from './Icons'
import { CfgQ, CfgRow } from './CfgRow'
import { CloudConsent } from './CloudConsent.tsx'
import { ModelNameRow } from './ModelNameRow.tsx'
import { ModelShelfPanel } from './ModelShelfPanel.tsx'
import { SettingsCloud } from './SettingsCloud.tsx'

/** 模型文件名的展示口径:全路径留在 data-tip 悬停里,行内只摆文件名 */
function fileBasename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/**
 * 「AI 设置」页的「模型」卡:AI 来源 + 随来源切换的连接配置
 * (内置:模型文件/模型货架/上下文窗口;LM Studio:服务地址/模型名;在线 API:见 SettingsCloud)。
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
  // 首次选「在线 API」时的隐私确认态:确认前配置不动,下拉暂显「在线 API」
  const [consentPending, setConsentPending] = useState(false)
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
              value={consentPending ? 'cloud' : config.provider}
              onChange={(e) => {
                const next = PROVIDER_OPTIONS.find((o) => o.id === e.target.value)?.id
                if (!next) return
                // 首次切到在线 API 先过隐私确认,确认前不改配置
                if (next === 'cloud' && !config.cloud.consented) {
                  setConsentPending(true)
                  return
                }
                setConsentPending(false)
                onConfigChange({ ...config, provider: next })
              }}
            >
              {PROVIDER_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </CfgRow>
          {consentPending ? (
            <CloudConsent
              onAccept={() => {
                setConsentPending(false)
                onConfigChange({
                  ...config,
                  provider: 'cloud',
                  cloud: { ...config.cloud, consented: true }
                })
              }}
              onCancel={() => setConsentPending(false)}
            />
          ) : config.provider === 'cloud' ? (
            <SettingsCloud
              cloud={config.cloud}
              onCloudChange={(cloud) => onConfigChange({ ...config, cloud })}
              models={models}
              modelsBusy={modelsBusy}
              modelsNote={modelsNote}
              listModels={listModels}
            />
          ) : isBuiltin ? (
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
              <ModelNameRow
                value={config.lmstudio.model}
                onChange={(model) =>
                  onConfigChange({ ...config, lmstudio: { ...config.lmstudio, model } })
                }
                models={models}
                modelsBusy={modelsBusy}
                modelsNote={modelsNote}
                listModels={listModels}
              />
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
