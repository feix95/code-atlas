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
  { key: 'light', name: '白天' },
  { key: 'dark', name: '黑夜' }
]

const THEME_SUB: Record<AppearancePreset, string> = {
  default: '默认',
  blue: '经典回归',
  custom: '手动调整'
}

/** 设置分区「外观」:亮暗 / 配色主题 / 自定义三色 / 界面大小滑杆(纯展示,状态全在 SettingsPage) */
export function SettingsAppearance({
  appearanceRef,
  draftAppearance,
  updateAppearance,
  enterCustom,
  previewAccent,
  defaultPreset,
  draftScale,
  scaleShown,
  setDragValue,
  commitDrag,
  stepScale
}: {
  appearanceRef: { current: HTMLElement | null }
  draftAppearance: Appearance
  updateAppearance: (patch: Partial<Appearance>) => void
  enterCustom: () => void
  previewAccent: string
  defaultPreset: (typeof COLOR_PRESETS)[number]
  draftScale: number
  scaleShown: number
  setDragValue: (v: number) => void
  commitDrag: () => void
  stepScale: (dir: number) => void
}): React.JSX.Element {
  return (
    <section
      className="cfg-section"
      ref={(el) => {
        appearanceRef.current = el
      }}
    >
      <h3 className="cfg-group-title">外观</h3>
      <div className="cfg-panel">
        <CfgRow label="亮还是暗">
          <div className="cfg-segmented">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={draftAppearance.mode === m.key ? 'is-selected' : ''}
                onClick={() => updateAppearance({ mode: m.key })}
              >
                {m.name}
              </button>
            ))}
          </div>
        </CfgRow>
        <div className="cfg-divider" />
        <CfgRow label="配色主题" hint="用在文件树、详情和状态信息上的一套颜色。">
          <div className="cfg-themes">
            {COLOR_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`cfg-theme${draftAppearance.preset === p.key ? ' is-selected' : ''}`}
                onClick={() => updateAppearance({ preset: p.key, accent: null, secondary: null })}
              >
                <span
                  className="cfg-swatch"
                  style={{
                    background: `linear-gradient(135deg, ${p.accent}, ${p.secondary})`
                  }}
                />
                <span>
                  <strong>{p.name}</strong>
                  <small>{THEME_SUB[p.key]}</small>
                </span>
                {draftAppearance.preset === p.key && (
                  <span className="cfg-theme-check">
                    <TreeIcon name="checkBare" size={12} mono />
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              className={`cfg-theme${draftAppearance.preset === 'custom' ? ' is-selected' : ''}`}
              onClick={enterCustom}
            >
              <span
                className="cfg-swatch"
                style={{
                  background: `linear-gradient(135deg, ${previewAccent}, ${draftAppearance.secondary ?? defaultPreset.secondary})`
                }}
              />
              <span>
                <strong>自定义</strong>
                <small>{THEME_SUB.custom}</small>
              </span>
              {draftAppearance.preset === 'custom' && (
                <span className="cfg-theme-check">
                  <TreeIcon name="checkBare" size={12} mono />
                </span>
              )}
            </button>
          </div>
        </CfgRow>
        {draftAppearance.preset === 'custom' && (
          <>
            <div className="cfg-divider" />
            <CfgRow
              label="自定义颜色"
              hint="主题色管按钮和选中项,辅助色管线框图标,底板色管画布底色。"
            >
              <div className="cfg-colors">
                <label className="cfg-color">
                  主题色
                  <input
                    type="color"
                    value={draftAppearance.accent ?? defaultPreset.accent}
                    onChange={(e) => updateAppearance({ preset: 'custom', accent: e.target.value })}
                  />
                </label>
                <label className="cfg-color">
                  辅助色
                  <input
                    type="color"
                    value={draftAppearance.secondary ?? defaultPreset.secondary}
                    onChange={(e) =>
                      updateAppearance({ preset: 'custom', secondary: e.target.value })
                    }
                  />
                </label>
                <label className="cfg-color">
                  底板色
                  <input
                    type="color"
                    value={
                      draftAppearance.base ?? (isDarkNow(draftAppearance) ? '#282828' : '#f6f6f6')
                    }
                    onChange={(e) => updateAppearance({ preset: 'custom', base: e.target.value })}
                  />
                </label>
                {draftAppearance.base && (
                  <button
                    type="button"
                    className="cfg-color-reset"
                    onClick={() => updateAppearance({ preset: 'custom', base: null })}
                  >
                    恢复石墨底
                  </button>
                )}
              </div>
            </CfgRow>
          </>
        )}
        <div className="cfg-divider" />
        <CfgRow label="界面大小" hint="调整文件树、标签和文字的整体缩放,只影响本机。">
          <div className="cfg-scale">
            <button
              type="button"
              className="cfg-stepper"
              aria-label="调小界面"
              onClick={() => stepScale(-0.05)}
              disabled={draftScale <= SCALE_MIN + 0.001}
            >
              <TreeIcon name="minus" size={13} mono />
            </button>
            <div className="cfg-slider-wrap">
              <input
                type="range"
                min={SCALE_MIN}
                max={SCALE_MAX}
                step={0.05}
                value={scaleShown}
                aria-label="界面缩放(80% 到 180%)"
                aria-valuetext={`${Math.round(scaleShown * 100)}%`}
                onChange={(e) => setDragValue(Number(e.target.value))}
                onPointerUp={commitDrag}
                onPointerCancel={commitDrag}
                onTouchEnd={commitDrag}
                onKeyUp={commitDrag}
                onBlur={commitDrag}
              />
              <div className="cfg-ticks" aria-hidden="true">
                <span>80%</span>
                <span>舒适</span>
                <span>180%</span>
              </div>
            </div>
            <button
              type="button"
              className="cfg-stepper"
              aria-label="调大界面"
              onClick={() => stepScale(0.05)}
              disabled={draftScale >= SCALE_MAX - 0.001}
            >
              <TreeIcon name="plus" size={13} mono />
            </button>
            <output className="cfg-scale-value">{Math.round(scaleShown * 100)}%</output>
          </div>
        </CfgRow>
      </div>
    </section>
  )
}
