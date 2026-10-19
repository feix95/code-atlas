import {
  CUSTOM_MAX,
  TEACHING_OPTIONS,
  TONE_OPTIONS,
  type PersonalizationConfig,
  type TeachingLevel,
  type ToneKey
} from '@shared/personalization'
import type { AiConfig } from '@shared/types'
import { CfgRow } from './CfgRow'

/** 「AI 设置」页的「回复风格」卡:语气 / 讲解深度 / 自定义指令(纯展示) */
export function SettingsVoice({
  config,
  personal,
  updatePersonal
}: {
  config: AiConfig | null
  personal: PersonalizationConfig
  updatePersonal: (patch: Partial<PersonalizationConfig>) => void
}): React.JSX.Element {
  return (
    <>
      {!config ? (
        <CfgRow label="语气" hint="读取配置中……">
          <span />
        </CfgRow>
      ) : (
        <>
          <CfgRow label="语气" hint="设置 AI 回复的说话方式。">
            <select
              className="cfg-select"
              aria-label="语气"
              value={personal.tone}
              onChange={(e) => updatePersonal({ tone: e.target.value as ToneKey })}
            >
              {TONE_OPTIONS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </CfgRow>
          <div className="cfg-divider" />
          <CfgRow label="讲解深度" hint="设置 AI 回复的详细程度。">
            <select
              className="cfg-select"
              aria-label="讲解深度"
              value={personal.teaching}
              onChange={(e) => updatePersonal({ teaching: e.target.value as TeachingLevel })}
            >
              {TEACHING_OPTIONS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </CfgRow>
          <div className="cfg-divider" />
          <details className="cfg-fold">
            <summary className="cfg-fold-summary">
              <div className="cfg-copy">
                <label>自定义指令</label>
                <p>对 AI 的额外要求，每次对话都生效。</p>
              </div>
            </summary>
            <div className="cfg-fold-body">
              {/* 字数计数贴输入框右下角(不占行名版面);底下留一块垫,长文写到末行不被计数盖住 */}
              <div className="cfg-ta-wrap">
                <textarea
                  className="cfg-textarea"
                  rows={5}
                  maxLength={CUSTOM_MAX}
                  value={personal.custom}
                  spellCheck={false}
                  aria-label="自定义指令"
                  placeholder="例：先给结论，术语用中文。"
                  onChange={(e) => updatePersonal({ custom: e.target.value })}
                />
                <span className="cfg-ta-count">
                  {personal.custom.length}/{CUSTOM_MAX}
                </span>
              </div>
            </div>
          </details>
        </>
      )}
    </>
  )
}
