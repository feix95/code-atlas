import type { AiConfig } from '@shared/types'
import { TreeIcon } from './Icons'
import { TavilyKeyField } from './TavilyKeyField.tsx'
import { CfgRow } from './CfgRow'

/** 设置分区「智能辅助」:AI 来源 / 联网查证 / Tavily Key / 推荐问题 / 数据范围(纯展示) */
export function SettingsAi({
  aiRef,
  draftConfig,
  setDraftConfig,
  isBuiltin,
  source,
  chatSuggestionsOn,
  onChatSuggestionsChange,
  privacyOpen,
  setPrivacyOpen
}: {
  aiRef: { current: HTMLElement | null }
  draftConfig: AiConfig | null
  setDraftConfig: React.Dispatch<React.SetStateAction<AiConfig | null>>
  isBuiltin: boolean
  source: { ok: boolean; text: string }
  chatSuggestionsOn: boolean
  onChatSuggestionsChange: (v: boolean) => void
  privacyOpen: boolean
  setPrivacyOpen: React.Dispatch<React.SetStateAction<boolean>>
}): React.JSX.Element {
  return (
    <section
      className="cfg-section"
      ref={(el) => {
        aiRef.current = el
      }}
    >
      <h3 className="cfg-group-title">智能辅助</h3>
      <div className="cfg-panel">
        {!draftConfig ? (
          <CfgRow label="AI 来源" hint="读取配置中……">
            <span />
          </CfgRow>
        ) : (
          <>
            <CfgRow
              label="AI 来源"
              hint="内置模型在本机运行;连接其他服务时,代码片段会发送到你填写的地址。"
            >
              <div className="cfg-segmented">
                <button
                  type="button"
                  className={!isBuiltin ? 'is-selected' : ''}
                  onClick={() => setDraftConfig({ ...draftConfig, provider: 'lmstudio' })}
                >
                  <TreeIcon name="cloud" size={14} mono />
                  <span>
                    <strong>LM Studio</strong>
                    <small>外部服务</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={isBuiltin ? 'is-selected' : ''}
                  onClick={() => setDraftConfig({ ...draftConfig, provider: 'builtin' })}
                >
                  <TreeIcon name="drive" size={14} mono />
                  <span>
                    <strong>内置模型</strong>
                    <small>本机直跑</small>
                  </span>
                </button>
              </div>
            </CfgRow>
            <div className="cfg-callout">
              <span className="cfg-callout-icon">
                <TreeIcon name={isBuiltin ? 'drive' : 'cloud'} size={13} mono />
              </span>
              <div>
                <strong>{isBuiltin ? '使用内置模型(本机直跑)' : '使用 LM Studio(外部服务)'}</strong>
                <p>
                  {isBuiltin
                    ? '推理引擎已内置,模型文件就是 AI 的大脑;分析全程不出本机,首次响应可能要等模型加载。'
                    : '先启动兼容服务并选模型;只有本机地址才留在这台电脑。'}
                </p>
              </div>
              <span className={`cfg-callout-state${source.ok ? '' : ' is-warn'}`}>
                <TreeIcon name={source.ok ? 'check' : 'help'} size={12} mono />
                {source.text}
              </span>
            </div>
            <div className="cfg-divider" />
            <CfgRow
              label={
                <>
                  联网查证
                  <span className={`cfg-flag${draftConfig.webLookup ? ' is-on' : ''}`}>
                    {draftConfig.webLookup ? '已开启' : '默认关闭'}
                  </span>
                </>
              }
              hint="认不出的名字会查公开资料修正回答;发出去的只有搜索词,文件内容不出门。"
            >
              <button
                type="button"
                role="switch"
                aria-checked={draftConfig.webLookup}
                aria-label="联网查证"
                className={`cfg-switch${draftConfig.webLookup ? ' is-on' : ''}`}
                onClick={() =>
                  setDraftConfig({ ...draftConfig, webLookup: !draftConfig.webLookup })
                }
              >
                <span />
              </button>
            </CfgRow>
            {/* Tavily 搜索 Key(可选,2026-09-17 小葵拍板):填了源队列 Tavily 打头,不填走免费链。
                          眼睛、体检、黄字提醒都住在 TavilyKeyField 里(左右留白照 cfg-row 口径,和上下行对齐) */}
            <TavilyKeyField
              value={draftConfig.tavilyKey ?? ''}
              onChange={(v) => setDraftConfig({ ...draftConfig, tavilyKey: v })}
            />
            {/* 推荐问题总闸:自由聊天和文件预览 AI 卡两头的推荐问题一把抓;拨一下立刻生效,不走下面的应用更改 */}
            <div className="cfg-divider" />
            <CfgRow
              label={
                <>
                  推荐问题
                  <span className={`cfg-flag${chatSuggestionsOn ? ' is-on' : ''}`}>
                    {chatSuggestionsOn ? '已开启' : '已关闭'}
                  </span>
                </>
              }
              hint="聊天框和预览卡下自动冒出的推荐问题;拨了马上生效,不用点应用更改。"
            >
              <button
                type="button"
                role="switch"
                aria-checked={chatSuggestionsOn}
                aria-label="推荐问题"
                className={`cfg-switch${chatSuggestionsOn ? ' is-on' : ''}`}
                onClick={() => onChatSuggestionsChange(!chatSuggestionsOn)}
              >
                <span />
              </button>
            </CfgRow>
            <div className="cfg-privacy">
              <TreeIcon name="shield" size={12} mono />
              <span>只发送认不出的名字,不发送路径或文件内容;不开启则完全离线。</span>
              <button type="button" onClick={() => setPrivacyOpen(!privacyOpen)}>
                {privacyOpen ? '收起' : '查看数据范围'}
                <TreeIcon name="chevron" size={11} mono />
              </button>
            </div>
            {privacyOpen && (
              <div className="cfg-privacy-more">
                查询链:填了 Tavily Key 则 Tavily 打头,之后 DuckDuckGo 公开页面 → 中文维基百科 →
                英文维基百科;单次查询 5
                秒超时,查不到就回退本地推测;查询结果只用于当前回答,不做任何其他用途。发出去的只有搜索词本身,不含本地路径和文件内容。
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
