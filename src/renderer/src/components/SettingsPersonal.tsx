import {
  CUSTOM_MAX,
  TEACHING_OPTIONS,
  TONE_OPTIONS,
  type PersonalizationConfig
} from '@shared/personalization'
import type { AiConfig } from '@shared/types'
import { TreeIcon } from './Icons'
import { OptionSelect } from './OptionSelect.tsx'
import { CfgRow } from './CfgRow'

/** 「试一句」的结果账本(SettingsPage 持有状态,这里只照单渲染) */
export type SampleState =
  { kind: 'busy' } | { kind: 'done'; text: string } | { kind: 'error'; text: string } | null

/** 设置分区「个性化」:语气 / 讲解深度 / 自订指令 / 试一句(纯展示,状态全在 SettingsPage) */
export function SettingsPersonal({
  personalRef,
  draftConfig,
  personal,
  updatePersonal,
  sample,
  setSample,
  tryStyle
}: {
  personalRef: { current: HTMLElement | null }
  draftConfig: AiConfig | null
  personal: PersonalizationConfig
  updatePersonal: (patch: Partial<PersonalizationConfig>) => void
  sample: SampleState
  setSample: React.Dispatch<React.SetStateAction<SampleState>>
  tryStyle: () => Promise<void>
}): React.JSX.Element {
  return (
    <section
      className="cfg-section"
      ref={(el) => {
        personalRef.current = el
      }}
    >
      <h3 className="cfg-group-title">个性化</h3>
      <div className="cfg-panel">
        {!draftConfig ? (
          <CfgRow label="说话方式" hint="读取配置中……">
            <span />
          </CfgRow>
        ) : (
          <>
            <CfgRow label="基本风格和语气">
              <OptionSelect
                options={TONE_OPTIONS}
                value={personal.tone}
                onChange={(tone) => updatePersonal({ tone })}
                ariaLabel="基本风格和语气"
              />
            </CfgRow>
            <div className="cfg-divider" />
            <CfgRow
              label="讲解深度"
              hint="「简洁」只说是什么;「精简」讲骨架带名词小课堂;「详细」会展开关键写法,更耗算力,上下文太小时自动退回精简。"
            >
              <OptionSelect
                options={TEACHING_OPTIONS}
                value={personal.teaching}
                onChange={(teaching) => updatePersonal({ teaching })}
                ariaLabel="讲解深度"
              />
            </CfgRow>
            <div className="cfg-divider" />
            <CfgRow
              stacked
              label={
                <>
                  自订指令
                  <span className="cfg-flag">
                    {personal.custom.length}/{CUSTOM_MAX}
                  </span>
                </>
              }
            >
              <textarea
                className="cfg-textarea"
                rows={5}
                maxLength={CUSTOM_MAX}
                value={personal.custom}
                spellCheck={false}
                aria-label="自订指令"
                placeholder={
                  '例如：告诉 AI 你的偏好、身份或回答风格，这些会在之后的对话中持续生效。'
                }
                onChange={(e) => updatePersonal({ custom: e.target.value })}
              />
            </CfgRow>
            <div className="cfg-privacy">
              <TreeIcon name="shield" size={12} mono />
              <span>自订指令只改说法不改事实:不许编造、点名真实函数、看不出来要明说。</span>
            </div>
            <div className="cfg-divider" />
            <CfgRow
              stacked
              label="试一句"
              hint="拿上面这套说法让模型当场念一段——用的是还没保存的草稿。"
            >
              <div className="cfg-sample-actions">
                <button
                  type="button"
                  className="cfg-btn"
                  onClick={() => void tryStyle()}
                  disabled={sample?.kind === 'busy'}
                >
                  <TreeIcon name="sparkles" size={13} mono />
                  {sample?.kind === 'busy' ? '正在念……' : '试一句'}
                </button>
                {sample?.kind === 'done' && (
                  <button
                    type="button"
                    className="cfg-btn is-ghost"
                    onClick={() => setSample(null)}
                  >
                    收起
                  </button>
                )}
              </div>
              {sample?.kind === 'busy' && (
                <div className="cfg-copy">
                  <p>正在让模型按这套说法说一遍,第一次可能要等模型热身……</p>
                </div>
              )}
              {sample?.kind === 'done' && <pre className="cfg-sample">{sample.text}</pre>}
              {sample?.kind === 'error' && <p className="cfg-sample is-error">{sample.text}</p>}
            </CfgRow>
          </>
        )}
      </div>
    </section>
  )
}
