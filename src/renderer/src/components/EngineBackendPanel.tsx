// 「推理引擎」面板(第 4 期):机器推荐 + 一键安装(带进度)+ 手动选择。
// 默认全自动 —— 推荐的后端没装就挂一条「推荐安装」;装了哪个用哪个,
// 自指程序路径(高级用法)仍然最大。任何下载都要用户点了「安装」才走。
import { useEffect, useRef, useState } from 'react'
import {
  approxDownloadMB,
  BACKEND_PREFERENCE,
  ENGINE_CATALOG,
  type EngineBackend,
  type EngineBackendChoice,
  type EngineStateInfo
} from '@shared/engineCatalog'
import type { AiConfig } from '@shared/types'
import { CfgQ, CfgRow } from './CfgRow'

const STAGE_LABEL: Record<string, string> = {
  download: '下载中',
  verify: '校验中',
  extract: '解压中',
  check: '试运行',
  done: '完成'
}

type PanelState = { status: 'loading' | 'error' } | { status: 'ready'; info: EngineStateInfo }

/** 「推理引擎」管理面板:推荐条 + 三后端清单 + 手动选择下拉 */
export function EngineBackendPanel({
  config,
  onConfigChange
}: {
  config: AiConfig | null
  onConfigChange: (next: AiConfig) => void
}): React.JSX.Element {
  const [state, setState] = useState<PanelState>({ status: 'loading' })
  const [installErr, setInstallErr] = useState<string | null>(null)
  const [progress, setProgress] = useState<{
    backend: EngineBackend
    stage: string
    percent: number
  } | null>(null)
  const seq = useRef(0)

  const refresh = async (): Promise<void> => {
    const my = ++seq.current
    const info = await window.atlas.engineState()
    if (my !== seq.current) return // 新一轮刷新落地了,旧结果让位
    setState(info ? { status: 'ready', info } : { status: 'error' })
  }
  // 首次取数;安装进度事件一来就地更新进度条 + 落地后整单重取
  useEffect(() => {
    void refresh()
    const off = window.atlas.onEngineInstallProgress((p) => {
      setProgress({ backend: p.backend, stage: p.stage, percent: p.percent })
      if (p.stage === 'done') {
        setProgress(null)
        void refresh()
      }
    })
    return off
  }, [])

  const backendChoice = (b: EngineBackendChoice | undefined): EngineBackendChoice => b ?? 'auto'
  const setBackend = (b: EngineBackendChoice): void => {
    if (!config) return
    onConfigChange({
      ...config,
      builtin: { ...config.builtin, backend: b === 'auto' ? undefined : b }
    })
    // 选了还没装的后端 → engineState 的 wantInstall 会推「推荐安装」条
    void refresh()
  }

  const install = async (b: EngineBackend): Promise<void> => {
    setInstallErr(null)
    setProgress({ backend: b, stage: 'download', percent: 0 })
    const r = await window.atlas.engineInstall(b)
    if (!r.ok) {
      setInstallErr(r.error ?? '安装失败')
      setProgress(null)
    }
    await refresh()
  }

  const remove = async (b: EngineBackend): Promise<void> => {
    setInstallErr(null)
    const r = await window.atlas.engineRemove(b)
    if (!r.ok) setInstallErr(r.error ?? '卸载失败')
    await refresh()
  }

  const info = state.status === 'ready' ? state.info : null
  const installing = progress ?? info?.installing ?? null
  const wantInstall = info?.wantInstall ?? null

  return (
    <CfgRow
      label={
        <>
          推理引擎
          <CfgQ tip="运行本地模型的推理引擎；按机器自动推荐，自带引擎始终可用。" />
        </>
      }
      stacked
    >
      <div>
        {state.status === 'loading' && <p className="cfg-note lp-note">正在检查引擎……</p>}
        {state.status === 'error' && (
          <p className="cfg-note lp-note">
            引擎状态读取失败，不影响使用。
            <button type="button" className="cfg-btn" onClick={() => void refresh()}>
              重试
            </button>
          </p>
        )}
        {info && (
          <>
            <p className="lp-line" data-tip={info.active?.version ?? undefined}>
              {info.active ? `${info.active.label} · 正在使用` : '没有可用引擎'}
            </p>
            {/* 推荐安装条:只挂横幅不自动下载,点「安装」才走网 */}
            {wantInstall && !installing && (
              <div className="eng-banner">
                <span>
                  推荐安装{ENGINE_CATALOG[wantInstall].displayName}引擎，约{' '}
                  {approxDownloadMB(wantInstall)}MB
                </span>
                <button
                  type="button"
                  className="cfg-btn eng-install"
                  onClick={() => void install(wantInstall)}
                >
                  安装
                </button>
              </div>
            )}
            {installing && (
              <div className="eng-progress">
                <div className="eng-bar">
                  <div className="eng-bar-fill" style={{ width: `${installing.percent}%` }} />
                </div>
                <span className="cfg-note">
                  {STAGE_LABEL[installing.stage] ?? installing.stage} · {installing.percent}%
                </span>
                <button
                  type="button"
                  className="cfg-btn"
                  onClick={() => void window.atlas.engineInstallCancel(installing.backend)}
                >
                  取消
                </button>
              </div>
            )}
            {installErr && <p className="cfg-note is-missing">✕ {installErr}</p>}
            <ul className="eng-list">
              {BACKEND_PREFERENCE.map((b) => {
                const installed = info.installed.includes(b)
                const busy = installing?.backend === b
                return (
                  <li key={b} className="eng-item">
                    <div className="eng-item-head">
                      <b>{ENGINE_CATALOG[b].displayName}</b>
                      <span className={`eng-state ${installed ? 'is-in' : ''}`}>
                        {installed ? '已安装' : '未安装'}
                      </span>
                      {!installed && (
                        <button
                          type="button"
                          className="cfg-btn"
                          disabled={busy || installing !== null}
                          onClick={() => void install(b)}
                        >
                          安装
                        </button>
                      )}
                      {installed && (
                        <button
                          type="button"
                          className="cfg-btn"
                          disabled={installing !== null}
                          onClick={() => void remove(b)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                    <p className="cfg-note lp-hint">{ENGINE_CATALOG[b].oneLine}</p>
                  </li>
                )
              })}
            </ul>
            <div className="lp-field">
              <label htmlFor="eng-choice">引擎选择</label>
              <div className="lp-field-ctl">
                <select
                  id="eng-choice"
                  className="cfg-select"
                  disabled={!config || installing !== null}
                  value={backendChoice(config?.builtin.backend)}
                  onChange={(e) => setBackend(e.target.value as EngineBackendChoice)}
                >
                  <option value="auto">自动(推荐)</option>
                  {BACKEND_PREFERENCE.map((b) => (
                    <option key={b} value={b}>
                      {ENGINE_CATALOG[b].displayName}
                      {info.installed.includes(b) ? '' : '，未安装'}
                    </option>
                  ))}
                </select>
              </div>
              <p className="cfg-note lp-hint">自动选择这台机器最快的引擎。</p>
            </div>
            <p className="cfg-note lp-hint lp-tail">
              下载失败或无网络时，可在高级选项手动指定引擎路径。
            </p>
          </>
        )}
      </div>
    </CfgRow>
  )
}
