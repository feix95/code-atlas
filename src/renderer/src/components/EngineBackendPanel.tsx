// 「推理引擎」面板(第 4 期):行格式与全页统一 —— 一行标题一行注解,右栏放操作;
// 推荐的后端在行内标「推荐安装」;装了哪个用哪个,自指程序路径(高级用法)仍然最大。
// 任何下载都要用户点了「安装」才走。
import { Fragment, useEffect, useRef, useState } from 'react'
import {
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

/** 「推理引擎」管理:状态注解 + 引擎选择下拉 + 三后端行内安装/删除 */
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
    // 选了还没装的后端 → engineState 的 wantInstall 会在该行标「推荐安装」
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

  // 行注解:状态一句话(检查中/出错/在用);版本串只在悬停里兜底展示
  const rowHint: React.ReactNode =
    state.status === 'loading' ? (
      '正在检查引擎……'
    ) : state.status === 'error' ? (
      '引擎状态读取失败，不影响使用。'
    ) : info?.active ? (
      <>
        本地推理引擎；
        <span data-tip={info.active.version ?? undefined}>正在使用 {info.active.label}</span>。
      </>
    ) : (
      '本地推理引擎；当前没有可用引擎。'
    )

  return (
    <>
      <div className="cfg-divider" />
      <CfgRow
        label={
          <>
            推理引擎
            <CfgQ tip="下载失败或无网络时，可在高级选项手动指定引擎路径。" />
          </>
        }
        hint={installErr ? <span className="cfg-hint is-bad">✕ {installErr}</span> : rowHint}
      >
        {state.status === 'error' ? (
          <button type="button" className="cfg-btn" onClick={() => void refresh()}>
            重试
          </button>
        ) : info ? (
          <select
            className="cfg-select cfg-select-md"
            aria-label="引擎选择"
            disabled={!config || installing !== null}
            value={backendChoice(config?.builtin.backend)}
            onChange={(e) => setBackend(e.target.value as EngineBackendChoice)}
          >
            <option value="auto">自动</option>
            {BACKEND_PREFERENCE.map((b) => (
              <option key={b} value={b}>
                {ENGINE_CATALOG[b].displayName}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}
      </CfgRow>
      {info &&
        BACKEND_PREFERENCE.map((b) => {
          const installed = info.installed.includes(b)
          const busy = installing?.backend === b
          const recommended = !installed && b === wantInstall
          return (
            <Fragment key={b}>
              <div className="cfg-divider" />
              <CfgRow label={ENGINE_CATALOG[b].displayName} hint={ENGINE_CATALOG[b].oneLine}>
                {busy && installing ? (
                  <div className="eng-install">
                    <div className="eng-bar">
                      <div className="eng-bar-fill" style={{ width: `${installing.percent}%` }} />
                    </div>
                    <span className="cfg-note">
                      {STAGE_LABEL[installing.stage] ?? installing.stage} · {installing.percent}%
                    </span>
                    <button
                      type="button"
                      className="cfg-btn"
                      onClick={() => void window.atlas.engineInstallCancel(b)}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="cfg-ctl">
                    <span
                      className={`eng-state${installed ? ' is-in' : recommended ? ' is-want' : ''}`}
                    >
                      {installed ? '已安装' : recommended ? '推荐安装' : '未安装'}
                    </span>
                    {installed ? (
                      <button
                        type="button"
                        className="cfg-btn"
                        disabled={installing !== null}
                        onClick={() => void remove(b)}
                      >
                        删除
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="cfg-btn"
                        disabled={installing !== null}
                        onClick={() => void install(b)}
                      >
                        安装
                      </button>
                    )}
                  </div>
                )}
              </CfgRow>
            </Fragment>
          )
        })}
    </>
  )
}
