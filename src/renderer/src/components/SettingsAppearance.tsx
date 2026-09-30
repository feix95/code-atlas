import { SCALE_MAX, SCALE_MIN } from '@shared/uiScale'
import {
  COLOR_PRESETS,
  isDarkNow,
  type Appearance,
  type AppearanceMode,
  type AppearancePreset
} from '../appearance'
import { TreeIcon } from './Icons'
import { CfgRow } from './CfgRow'

const MODES: Array<{ key: AppearanceMode; name: string }> = [
  { key: 'auto', name: '跟随系统' },
  { key: 'light', name: '浅色' },
  { key: 'dark', name: '深色' }
]

/** 「外观」页:外观模式 / 配色主题 / 自定义颜色 / 界面缩放(纯展示,状态全在 SettingsPage) */
export function SettingsAppearance({
  appearance,
  updateAppearance,
  enterCustom,
  defaultPreset,
  scaleShown,
  setDragValue,
  commitDrag,
  resetScale
}: {
  appearance: Appearance
  updateAppearance: (patch: Partial<Appearance>) => void
  enterCustom: () => void
  defaultPreset: (typeof COLOR_PRESETS)[number]
  scaleShown: number
  setDragValue: (v: number | null) => void
  commitDrag: () => void
  /** 复位钮:回到 100%,即改即存 */
  resetScale: () => void
}): React.JSX.Element {
  // 行头预览色珠:预设档画预设的主题色→辅助色渐变;自定义档画当前调出的两色
  const activePreset = COLOR_PRESETS.find((p) => p.key === appearance.preset) ?? defaultPreset
  const dotAccent = appearance.accent ?? activePreset.accent
  const dotSecondary = appearance.secondary ?? activePreset.secondary
  const scalePct = ((scaleShown - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100

  return (
    <div className="cfg-pane">
      <div className="cfg-panel">
        <CfgRow label="外观模式">
          <select
            className="cfg-select"
            aria-label="外观模式"
            value={appearance.mode}
            onChange={(e) => updateAppearance({ mode: e.target.value as AppearanceMode })}
          >
            {MODES.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name}
              </option>
            ))}
          </select>
        </CfgRow>
        <div className="cfg-divider" />
        <CfgRow label="配色主题" hint="应用于文件树、详情与状态信息的配色。">
          <div className="cfg-ctl">
            <span
              className="cfg-dot-preview"
              style={{ background: `linear-gradient(135deg,${dotAccent},${dotSecondary})` }}
            />
            <select
              className="cfg-select"
              aria-label="配色主题"
              value={appearance.preset}
              onChange={(e) => {
                const key = e.target.value as AppearancePreset
                if (key === 'custom') enterCustom()
                else updateAppearance({ preset: key, accent: null, secondary: null })
              }}
            >
              {COLOR_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
              <option value="custom">自定义</option>
            </select>
          </div>
        </CfgRow>
        {appearance.preset === 'custom' && (
          <>
            <div className="cfg-divider" />
            <CfgRow label="自定义颜色" hint="依次对应按钮与选中项、图标、画布。">
              <div className="cfg-colors">
                <label className="cfg-color">
                  主题色
                  <input
                    type="color"
                    aria-label="主题色"
                    value={appearance.accent ?? defaultPreset.accent}
                    onChange={(e) => updateAppearance({ preset: 'custom', accent: e.target.value })}
                  />
                </label>
                <label className="cfg-color">
                  辅助色
                  <input
                    type="color"
                    aria-label="辅助色"
                    value={appearance.secondary ?? defaultPreset.secondary}
                    onChange={(e) =>
                      updateAppearance({ preset: 'custom', secondary: e.target.value })
                    }
                  />
                </label>
                <label className="cfg-color">
                  底板色
                  <input
                    type="color"
                    aria-label="底板色"
                    value={appearance.base ?? (isDarkNow(appearance) ? '#282828' : '#f6f6f6')}
                    onChange={(e) => updateAppearance({ preset: 'custom', base: e.target.value })}
                  />
                </label>
                {/* 一键回石墨底:三个色全清空,输入框回落到默认档种子色 */}
                <button
                  type="button"
                  className="cfg-icon-btn"
                  aria-label="恢复石墨色"
                  data-tip="恢复石墨色"
                  onClick={() =>
                    updateAppearance({
                      preset: 'custom',
                      accent: null,
                      secondary: null,
                      base: null
                    })
                  }
                >
                  <TreeIcon name="refresh" size={14} mono />
                </button>
              </div>
            </CfgRow>
          </>
        )}
        <div className="cfg-divider" />
        <CfgRow label="界面缩放" hint="调整界面整体缩放，仅影响本机。">
          <div className="cfg-scale">
            <button
              type="button"
              className="cfg-icon-btn"
              aria-label="恢复默认缩放"
              data-tip="恢复 100%"
              onClick={resetScale}
            >
              <TreeIcon name="refresh" size={14} mono />
            </button>
            <output className="cfg-scale-value">{Math.round(scaleShown * 100)}%</output>
            <div className="cfg-slider-wrap">
              <input
                type="range"
                min={SCALE_MIN}
                max={SCALE_MAX}
                step={0.05}
                value={scaleShown}
                style={{ '--p': `${scalePct}%` } as React.CSSProperties}
                aria-label="界面缩放(80% 到 180%)"
                aria-valuetext={`${Math.round(scaleShown * 100)}%`}
                onChange={(e) => setDragValue(Number(e.target.value))}
                onPointerUp={commitDrag}
                onPointerCancel={commitDrag}
                onTouchEnd={commitDrag}
                onKeyUp={commitDrag}
                onBlur={commitDrag}
              />
            </div>
          </div>
        </CfgRow>
      </div>
    </div>
  )
}
