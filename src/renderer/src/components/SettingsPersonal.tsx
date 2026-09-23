import {
  CUSTOM_MAX,
  TEACHING_OPTIONS,
  TONE_OPTIONS,
  type PersonalizationConfig
} from '@shared/personalization'
import type { AiConfig } from '@shared/types'
import { TreeIcon } from './Icons'
import { OptionSelect } from './OptionSelect.tsx'

/** 「试一句」的结果账本(SettingsDialog 持有状态,这里只照单渲染) */
export type SampleState =
  { kind: 'busy' } | { kind: 'done'; text: string } | { kind: 'error'; text: string } | null

/** 设置分区「02 个性化」:语气 / 讲解深度 / 自订指令 / 试一句(纯展示,状态全在 SettingsDialog) */
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
      <div className="cfg-section-head">
        <div>
          <span className="cfg-step">02</span>
          <h3>个性化</h3>
        </div>
        <span>决定 AI 怎么跟你说话</span>
      </div>
      <div className="cfg-panel">
        {!draftConfig ? (
          <div className="cfg-row">
            <div className="cfg-copy">
              <label>说话方式</label>
              <p>读取配置中……</p>
            </div>
          </div>
        ) : (
          <>
            <div className="cfg-row">
              <div className="cfg-copy">
                <label>基本风格和语气</label>
              </div>
              <OptionSelect
                options={TONE_OPTIONS}
                value={personal.tone}
                onChange={(tone) => updatePersonal({ tone })}
                ariaLabel="基本风格和语气"
              />
            </div>
            <div className="cfg-divider" />
            <div className="cfg-row">
              <div className="cfg-copy">
                <label>讲解深度</label>
                <p>
                  讲代码和文件时讲多细。「简洁」只说这东西是干什么的；「精简」先讲骨架、带几条名词小课堂；「详细」还会讲这门语言用到了哪些写法，并挑关键处展开（更耗算力，模型上下文太小时会自动退回精简，届时会明说）。
                </p>
              </div>
              <OptionSelect
                options={TEACHING_OPTIONS}
                value={personal.teaching}
                onChange={(teaching) => updatePersonal({ teaching })}
                ariaLabel="讲解深度"
              />
            </div>
            <div className="cfg-divider" />
            <div className="cfg-row cfg-row-stack">
              <div className="cfg-copy">
                <label>
                  自订指令
                  <span className="cfg-flag">
                    {personal.custom.length}/{CUSTOM_MAX}
                  </span>
                </label>
              </div>
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
            </div>
            <div className="cfg-privacy">
              <TreeIcon name="shield" size={12} mono />
              <span>
                自订指令只改说法,不改事实:不许编造、必须点名真实函数、看不出来的要明说 ——
                这几条铁律不跟着变。
              </span>
            </div>
            <div className="cfg-divider" />
            <div className="cfg-row cfg-row-stack">
              <div className="cfg-copy">
                <label>试一句</label>
                <p>
                  拿上面这套说法,让当前模型当场念一段小代码 ——
                  光看文字描述听不出语气,听一遍最准。用的是还没保存的草稿。
                </p>
              </div>
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
            </div>
          </>
        )}
      </div>
    </section>
  )
}
