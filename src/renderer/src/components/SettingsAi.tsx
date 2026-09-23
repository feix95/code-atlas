import type { AiConfig } from '@shared/types'
import { TreeIcon } from './Icons'
import { TavilyKeyField } from './TavilyKeyField.tsx'

/** 设置分区「03 智能辅助」:AI 来源 / 联网查证 / Tavily Key / 推荐问题 / 数据范围(纯展示) */
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
      <div className="cfg-section-head">
        <div>
          <span className="cfg-step">03</span>
          <h3>智能辅助</h3>
        </div>
        <span>决定分析请求从哪里出发</span>
      </div>
      <div className="cfg-panel">
        {!draftConfig ? (
          <div className="cfg-row">
            <div className="cfg-copy">
              <label>AI 来源</label>
              <p>读取配置中……</p>
            </div>
          </div>
        ) : (
          <>
            <div className="cfg-row">
              <div className="cfg-copy">
                <label>AI 来源</label>
                <p>
                  内置模型在本机运行。连接其他服务时,代码片段会发送到你填写的服务地址,请确认它值得信任。
                </p>
              </div>
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
            </div>
            <div className="cfg-callout">
              <span className="cfg-callout-icon">
                <TreeIcon name={isBuiltin ? 'drive' : 'cloud'} size={13} mono />
              </span>
              <div>
                <strong>{isBuiltin ? '使用内置模型(本机直跑)' : '使用 LM Studio(外部服务)'}</strong>
                <p>
                  {isBuiltin
                    ? '推理引擎已内置,模型文件就是 AI 的大脑;分析全程不出本机,复杂项目的首次响应可能要等模型加载。'
                    : '先启动兼容服务并选择模型。代码片段会发往填写的地址;只有本机地址才留在这台电脑。'}
                </p>
              </div>
              <span className={`cfg-callout-state${source.ok ? '' : ' is-warn'}`}>
                <TreeIcon name={source.ok ? 'check' : 'help'} size={12} mono />
                {source.text}
              </span>
            </div>
            <div className="cfg-divider" />
            <div className="cfg-row">
              <div className="cfg-copy">
                <label>
                  联网查证
                  <span className={`cfg-flag${draftConfig.webLookup ? ' is-on' : ''}`}>
                    {draftConfig.webLookup ? '已开启' : '默认关闭'}
                  </span>
                </label>
                <p>
                  讲解认不出某个软件/文件时,按「名字」查公开资料修正回答;对话翻文件模式里,模型也能自己上网查资料。发出去的只有搜索词,本地文件内容绝不出门。
                </p>
              </div>
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
            </div>
            {/* Tavily 搜索 Key(可选,2026-09-17 小葵拍板):填了源队列 Tavily 打头,不填走免费链。
                          眼睛、体检、黄字提醒都住在 TavilyKeyField 里(左右留白照 cfg-row 口径,和上下行对齐) */}
            <TavilyKeyField
              value={draftConfig.tavilyKey ?? ''}
              onChange={(v) => setDraftConfig({ ...draftConfig, tavilyKey: v })}
            />
            {/* 推荐问题总闸:自由聊天和文件预览 AI 卡两头的推荐问题一把抓;拨一下立刻生效,不走下面的应用更改 */}
            <div className="cfg-row">
              <div className="cfg-copy">
                <label>
                  推荐问题
                  <span className={`cfg-flag${chatSuggestionsOn ? ' is-on' : ''}`}>
                    {chatSuggestionsOn ? '已开启' : '已关闭'}
                  </span>
                </label>
                <p>
                  聊天框和文件预览的 AI
                  卡下面自动冒出的那排「可以问问看」,觉得问不上就关;关了也不再为猜这些问题白花模型的功夫。拨了马上生效,不用点应用更改。
                </p>
              </div>
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
            </div>
            <div className="cfg-privacy">
              <TreeIcon name="shield" size={12} mono />
              <span>仅发送认不出的「名字」,绝不发送文件夹路径或文件内容;不开启则完全离线。</span>
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
