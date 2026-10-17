// 「高级设置」面板(智能启动锤第三期):默认全自动,想上手的人逐项指定;
// 每一项都能退回「自动」,一颗钮全恢复。草稿一改马上出预览方案,存档走上层防抖落盘。
import { useState } from 'react'
import type { LaunchParams } from '@shared/launchPlan'
import {
  EXTRA_ARGS_ALLOWED,
  parseExtraArgs,
  type ModelLaunchSettings
} from '@shared/launchSettings'
import { CfgQ, CfgRow } from './CfgRow'

/** 数手动调整了几项(徽标用):override 每字段算一项,专家命令行非空算一项 */
function overrideCount(s: ModelLaunchSettings): number {
  return Object.keys(s.overrides ?? {}).length + (s.extraArgs?.trim() ? 1 : 0)
}

/** 「自动，当前推荐 X」的 X:对照自动方案的参数翻成人话 */
function autoHint(
  auto: LaunchParams | null,
  field: keyof LaunchParams,
  label: (v: string) => string
): string {
  if (!auto) return ''
  const v = auto[field]
  return `当前推荐 ${label(String(v))}`
}

export function LaunchAdvancedPanel({
  draft,
  autoParams,
  hasMmproj,
  disabled,
  onChange
}: {
  draft: ModelLaunchSettings
  autoParams: LaunchParams | null
  hasMmproj: boolean
  disabled: boolean
  onChange: (next: ModelLaunchSettings) => void
}): React.JSX.Element {
  const ov = draft.overrides ?? {}
  const setOv = (patch: Partial<NonNullable<ModelLaunchSettings['overrides']>>): void => {
    const next = { ...ov, ...patch }
    onChange({ ...draft, overrides: next })
  }
  const count = overrideCount(draft)
  const extra = parseExtraArgs(draft.extraArgs ?? '')
  // 显卡层数的手动数字框:手动档才露面,值越界时原地夹回 0-999
  // (存档里的 'auto' 跟没指定一回事,统一显成自动档)
  const layersManual = typeof ov.gpuLayers === 'number'
  const [layersText, setLayersText] = useState('')

  return (
    <details className="cfg-fold">
      <summary className="cfg-fold-summary">
        <div className="cfg-copy">
          <label>
            高级设置
            {count > 0 && <span className="lp-badge">已手动调整 {count} 项</span>}
          </label>
          <p>逐项微调启动参数；默认全自动。</p>
        </div>
        <button
          type="button"
          className="cfg-btn lp-reset"
          disabled={disabled || count === 0}
          onClick={(e) => {
            e.preventDefault()
            setLayersText('')
            onChange({})
          }}
        >
          全部恢复自动
        </button>
      </summary>
      <div className="cfg-fold-body">
        <div className="cfg-divider" />
        <CfgRow label="显卡层数" hint="放到显卡上的模型层数；越多越快，越占显存。">
          <div className="cfg-ctl">
            <select
              className="cfg-select"
              aria-label="显卡层数"
              disabled={disabled}
              value={layersManual ? 'manual' : 'auto'}
              onChange={(e) => {
                if (e.target.value === 'auto') {
                  const next = { ...ov }
                  delete next.gpuLayers
                  onChange({ ...draft, overrides: next })
                } else {
                  const n = Number(layersText) || 0
                  setOv({ gpuLayers: n })
                }
              }}
            >
              <option value="auto">自动</option>
              <option value="manual">手动指定</option>
            </select>
            {layersManual && (
              <input
                className="cfg-input lp-num"
                type="number"
                min={0}
                max={999}
                step={1}
                disabled={disabled}
                aria-label="显卡层数，范围 0 到 999"
                value={typeof ov.gpuLayers === 'number' ? String(ov.gpuLayers) : ''}
                onChange={(e) => {
                  setLayersText(e.target.value)
                  const n = Number(e.target.value)
                  if (e.target.value !== '' && Number.isInteger(n) && n >= 0 && n <= 999) {
                    setOv({ gpuLayers: n })
                  }
                }}
              />
            )}
          </div>
        </CfgRow>
        <div className="cfg-divider" />
        <CfgRow label="缓存格式" hint="缓存精度；q8_0 省显存，可能轻微影响输出质量。">
          <select
            className="cfg-select"
            aria-label="缓存格式"
            disabled={disabled}
            value={ov.kvCache ?? 'auto'}
            onChange={(e) => {
              if (e.target.value === 'auto') {
                const next = { ...ov }
                delete next.kvCache
                onChange({ ...draft, overrides: next })
              } else setOv({ kvCache: e.target.value as 'f16' | 'q8_0' })
            }}
          >
            <option value="auto">自动，{autoHint(autoParams, 'kvCache', (v) => v)}</option>
            <option value="f16">f16，精度最好</option>
            <option value="q8_0">q8_0，省一半显存</option>
          </select>
        </CfgRow>
        <div className="cfg-divider" />
        <CfgRow label="Flash Attention" hint="更省显存、更快的注意力算法；部分老模型可能不兼容。">
          <select
            className="cfg-select"
            aria-label="Flash Attention"
            disabled={disabled}
            value={ov.flashAttn ?? 'auto'}
            onChange={(e) => {
              if (e.target.value === 'auto') {
                const next = { ...ov }
                delete next.flashAttn
                onChange({ ...draft, overrides: next })
              } else setOv({ flashAttn: 'on' })
            }}
          >
            <option value="auto">
              自动，{autoHint(autoParams, 'flashAttn', (v) => (v === 'on' ? '开' : '关'))}
            </option>
            <option value="on">开</option>
          </select>
        </CfgRow>

        {hasMmproj && (
          <>
            <div className="cfg-divider" />
            <CfgRow label="视觉文件放哪" hint="视觉文件的位置；放内存省约 1.3GB 显存，看图变慢。">
              <select
                className="cfg-select"
                aria-label="视觉文件放哪"
                disabled={disabled}
                value={ov.mmprojOffload === undefined ? 'auto' : ov.mmprojOffload ? 'gpu' : 'cpu'}
                onChange={(e) => {
                  if (e.target.value === 'auto') {
                    const next = { ...ov }
                    delete next.mmprojOffload
                    onChange({ ...draft, overrides: next })
                  } else setOv({ mmprojOffload: e.target.value === 'gpu' })
                }}
              >
                <option value="auto">
                  自动，
                  {autoHint(autoParams, 'mmprojOffload', (v) =>
                    v === 'true' ? '放显卡' : '放内存'
                  )}
                </option>
                <option value="gpu">放显卡，看图快</option>
                <option value="cpu">放内存，省显存</option>
              </select>
            </CfgRow>
          </>
        )}

        <div className="cfg-divider" />
        <CfgRow
          label={
            <>
              额外命令行参数
              <CfgQ tip={`仅支持以下参数：${EXTRA_ARGS_ALLOWED.join('  ')}`} />
            </>
          }
          hint="追加到启动参数末尾；无效参数不会生效。"
        >
          <div className="cfg-ctlcol">
            <input
              aria-label="额外命令行参数"
              className="cfg-input lp-extra"
              type="text"
              spellCheck={false}
              autoComplete="off"
              disabled={disabled}
              placeholder="如 -t 6 -b 1024，留空不加"
              value={draft.extraArgs ?? ''}
              onChange={(e) => onChange({ ...draft, extraArgs: e.target.value })}
            />
            {!extra.ok && <p className="cfg-note is-missing">✕ {extra.reason}</p>}
          </div>
        </CfgRow>
      </div>
    </details>
  )
}
