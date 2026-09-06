import { useState } from 'react'
import {
  applyAppearance,
  COLOR_PRESETS,
  loadAppearance,
  saveAppearance,
  type Appearance,
  type AppearanceMode
} from '../appearance'

// 界面缩放范围(跟 VS Code 的界面缩放一个意思):连续滑条随意调,小屏幕调小,大显示器调大
const SCALE_MIN = 0.8
const SCALE_MAX = 1.8

const MODES: Array<{ key: AppearanceMode; name: string }> = [
  { key: 'auto', name: '跟随系统' },
  { key: 'light', name: '白天' },
  { key: 'dark', name: '黑夜' }
]

/**
 * 外观设置:改了当场生效,不用保存按钮 —— 亮暗和配色直接刷新整个界面,
 * 看不顺眼再点回来就是,没有「保存了才生效」这一说。
 */
export function AppearanceSettings(): React.JSX.Element {
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance)
  const [scale, setScale] = useState<number>(() => window.atlas.getUiScale())
  // 拖动途中只记预览值不动界面;松手(或键盘松键/失焦收尾)才真换根字号 —— 整个界面
  // 重排一次就够,不会一路拖着一路抖
  const [dragValue, setDragValue] = useState<number | null>(null)

  function update(next: Appearance): void {
    setAppearance(next)
    saveAppearance(next)
    applyAppearance(next)
  }

  function applyScale(next: number): void {
    const v = Math.min(Math.max(next, SCALE_MIN), SCALE_MAX)
    setScale(v)
    window.atlas.setUiScale(v)
  }

  function stepScale(dir: number): void {
    applyScale(Math.round((scale + dir) * 100) / 100)
  }

  function commitDrag(): void {
    if (dragValue === null) return
    if (dragValue !== scale) applyScale(dragValue)
    setDragValue(null)
  }

  const preset = COLOR_PRESETS.find((p) => p.key === appearance.preset) ?? COLOR_PRESETS[0]

  // 进自定义档:拿当前生效的颜色当起点(没自定义过就抄当前预设的),取色器不空着手出现
  function enterCustom(): void {
    update({
      ...appearance,
      preset: 'custom',
      accent: appearance.accent ?? preset.accent,
      secondary: appearance.secondary ?? preset.secondary
    })
  }

  return (
    <div className="ai-settings">
      <div className="ai-field">
        <span className="ai-label">亮还是暗</span>
        <div className="ai-providers">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`chip chip-link ${appearance.mode === m.key ? 'is-on' : ''}`}
              onClick={() => update({ ...appearance, mode: m.key })}
            >
              {m.name}
            </button>
          ))}
        </div>
        <p className="ai-hint">选「跟随系统」就跟 Windows 的深浅色一起换;想固定住就点「白天」或「黑夜」。</p>
      </div>

      <div className="ai-field">
        <span className="ai-label">配色</span>
        <div className="ai-providers">
          {COLOR_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`chip chip-link ${appearance.preset === p.key ? 'is-on' : ''}`}
              onClick={() => update({ ...appearance, preset: p.key, accent: null, secondary: null })}
            >
              <i className="preset-dot" style={{ background: p.accent }} aria-hidden="true" />
              <i className="preset-dot" style={{ background: p.secondary }} aria-hidden="true" />
              {p.name}
            </button>
          ))}
          <button type="button" className={`chip chip-link ${appearance.preset === 'custom' ? 'is-on' : ''}`} onClick={enterCustom}>
            自定义
          </button>
        </div>
        {appearance.preset === 'custom' && (
          <div className="ai-row">
            <label className="color-pick">
              主题色
              <input
                type="color"
                className="color-input"
                value={appearance.accent ?? preset.accent}
                onChange={(e) => update({ ...appearance, preset: 'custom', accent: e.target.value })}
              />
            </label>
            <label className="color-pick">
              辅助色
              <input
                type="color"
                className="color-input"
                value={appearance.secondary ?? preset.secondary}
                onChange={(e) => update({ ...appearance, preset: 'custom', secondary: e.target.value })}
              />
            </label>
          </div>
        )}
        <p className="ai-hint">
          点现成配色一键换装;点「自定义」自己调主题色和辅助色,连边框线、卡片底下的画布色都跟着变。换回任何预设会扔掉自定义色,两边不打架。
        </p>
      </div>

      <div className="ai-field">
        <span className="ai-label">界面大小</span>
        <div className="ai-row">
          <button type="button" className="btn" aria-label="调小界面" onClick={() => stepScale(-0.05)} disabled={scale <= SCALE_MIN + 0.001}>
            −
          </button>
          <input
            type="range"
            className="scale-slider"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={0.05}
            value={dragValue ?? scale}
            aria-label="界面缩放(80% 到 180%)"
            aria-valuetext={`${Math.round((dragValue ?? scale) * 100)}%`}
            onChange={(e) => setDragValue(Number(e.target.value))}
            onPointerUp={commitDrag}
            onPointerCancel={commitDrag}
            onTouchEnd={commitDrag}
            onKeyUp={commitDrag}
            onBlur={commitDrag}
          />
          <span className="scale-value mono">{Math.round((dragValue ?? scale) * 100)}%</span>
          <button type="button" className="btn" aria-label="调大界面" onClick={() => stepScale(0.05)} disabled={scale >= SCALE_MAX - 0.001}>
            +
          </button>
        </div>
        <p className="ai-hint">拖滑条,松手才换装;点两边加减立刻生效。80% 到 180% 随意,左边文件树跟着一起变大变小。</p>
      </div>
    </div>
  )
}
