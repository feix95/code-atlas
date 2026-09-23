import { DEFAULT_CONTEXT_SIZE, DEFAULT_LMSTUDIO_BASE_URL } from '@shared/aiDefaults'
import type { ContextBill } from '@shared/contextBill'
import type { AiConfig, ModelContextInfo, ModelFitVerdict } from '@shared/types'
import { TreeIcon } from './Icons'
import { ModelShelfPanel } from './ModelShelfPanel.tsx'

/** 设置分区「04 高级选项」:本地模型路径 / 模型货架 / LM Studio 连接 / 上下文档位 / 后台日志与版本(纯展示) */
export function SettingsAdvanced({
  advancedRef,
  draftConfig,
  setDraftConfig,
  isBuiltin,
  pickModel,
  shelfOpen,
  setShelfOpen,
  onShelfModelReady,
  modelPathDraft,
  fitNote,
  models,
  modelsBusy,
  modelsNote,
  listModels,
  contextRaw,
  setContextRaw,
  onContextBlur,
  contextNotches,
  ctxNotchIndex,
  commitContextValue,
  ctxInfo,
  ctxBill,
  appVersion,
  themeName,
  draftScale,
  dirty
}: {
  advancedRef: { current: HTMLElement | null }
  draftConfig: AiConfig | null
  setDraftConfig: React.Dispatch<React.SetStateAction<AiConfig | null>>
  isBuiltin: boolean
  pickModel: () => Promise<void>
  shelfOpen: boolean
  setShelfOpen: React.Dispatch<React.SetStateAction<boolean>>
  onShelfModelReady: () => void
  modelPathDraft: string
  fitNote: ModelFitVerdict | null
  models: string[]
  modelsBusy: boolean
  modelsNote: string | null
  listModels: () => Promise<void>
  contextRaw: string
  setContextRaw: React.Dispatch<React.SetStateAction<string>>
  onContextBlur: () => void
  contextNotches: number[]
  ctxNotchIndex: number
  commitContextValue: (v: number) => void
  ctxInfo: ModelContextInfo | null
  ctxBill: ContextBill | null
  appVersion: string | null
  themeName: string
  draftScale: number
  dirty: boolean
}): React.JSX.Element {
  return (
    <section
      className="cfg-section"
      ref={(el) => {
        advancedRef.current = el
      }}
    >
      <div className="cfg-section-head">
        <div>
          <span className="cfg-step">04</span>
          <h3>高级选项</h3>
        </div>
        <span>本地模型与连接详情(常开:换模型是常干活,不再折着藏)</span>
      </div>
      {/* 常开面板(小葵定的板:换模型是高频活,折叠的那一下点击纯属过路费;
                    防误改的保险在「保存」那一环 —— 不点保存,改了也白改) */}
      <div className="cfg-panel cfg-advanced">
        <div className="cfg-advanced-head">
          <span className="cfg-advanced-icon">
            <TreeIcon name="sliders" size={13} mono />
          </span>
          <span>
            <strong>本地模型连接</strong>
            <small>
              {isBuiltin ? '推理引擎已内置,这里选大脑文件' : 'LM Studio 的服务地址与模型名'}
            </small>
          </span>
        </div>
        {draftConfig && (
          <div className="cfg-advanced-body">
            {isBuiltin ? (
              <>
                <div className="cfg-field-head">
                  <label htmlFor="cfg-model-path">模型文件</label>
                  <span>一个文件</span>
                </div>
                <div className="cfg-path-input">
                  <TreeIcon name="folder" size={13} mono />
                  <input
                    id="cfg-model-path"
                    value={draftConfig.builtin.modelPath}
                    placeholder="例如 D:\models\my-model.gguf"
                    onChange={(e) =>
                      setDraftConfig({
                        ...draftConfig,
                        builtin: { ...draftConfig.builtin, modelPath: e.target.value }
                      })
                    }
                  />
                  <button type="button" onClick={() => void pickModel()}>
                    选择模型
                  </button>
                </div>
                <p className="cfg-field-help">
                  模型是 AI 的大脑,一个独立文件;以后想换更强的 AI,换个模型文件就行。
                </p>
                <div className="cfg-field-head">
                  <label>模型货架</label>
                  <span>实时榜单</span>
                </div>
                <button
                  type="button"
                  className="cfg-shelf-toggle"
                  onClick={() => setShelfOpen((v) => !v)}
                >
                  <TreeIcon name={shelfOpen ? 'chevron' : 'sparkles'} size={13} mono />
                  {shelfOpen ? '收起货架' : '逛逛模型货架——实时热门 AI 模型榜,按大小挑,点开就能下'}
                </button>
                {shelfOpen && <ModelShelfPanel onModelReady={onShelfModelReady} />}
                {/* 量尺只替账单喊「文件不存在」这一嗓子(2026-09-18 小葵:两行黄字重复) ——
                              装得下/有点挤/装不下这些账,下面跟着滑条实时动的上下文账单都算,别报两遍 */}
                {modelPathDraft.trim() && fitNote && fitNote.level === 'missing' && (
                  <p className="cfg-field-help cfg-fit-note is-missing">
                    ✕ {fitNote.title}:{fitNote.detail}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="cfg-field-head">
                  <label htmlFor="cfg-baseurl">模型服务地址</label>
                  <span>LM Studio</span>
                </div>
                <div className="cfg-path-input">
                  <TreeIcon name="cloud" size={13} mono />
                  <input
                    id="cfg-baseurl"
                    value={draftConfig.lmstudio.baseUrl}
                    placeholder={DEFAULT_LMSTUDIO_BASE_URL}
                    onChange={(e) =>
                      setDraftConfig({
                        ...draftConfig,
                        lmstudio: { ...draftConfig.lmstudio, baseUrl: e.target.value }
                      })
                    }
                  />
                </div>
                <div className="cfg-field-head">
                  <label htmlFor="cfg-model-name">模型名</label>
                  <span>点「读取模型」自动填</span>
                </div>
                <div className="cfg-path-input">
                  <TreeIcon name="drive" size={13} mono />
                  <input
                    id="cfg-model-name"
                    value={draftConfig.lmstudio.model}
                    placeholder="或手动填写"
                    onChange={(e) =>
                      setDraftConfig({
                        ...draftConfig,
                        lmstudio: { ...draftConfig.lmstudio, model: e.target.value }
                      })
                    }
                  />
                  <button type="button" onClick={() => void listModels()}>
                    {modelsBusy ? '连接中……' : '读取模型'}
                  </button>
                </div>
                {models.length > 0 && (
                  <div className="cfg-chip-row">
                    {models.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={m === draftConfig.lmstudio.model ? 'is-selected' : ''}
                        onClick={() =>
                          setDraftConfig({
                            ...draftConfig,
                            lmstudio: { ...draftConfig.lmstudio, model: m }
                          })
                        }
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
                {modelsNote && <p className="cfg-field-help is-warn">{modelsNote}</p>}
                <p className="cfg-field-help">
                  LM Studio 里开「开发者」本地服务,地址一般是 {DEFAULT_LMSTUDIO_BASE_URL}。
                </p>
              </>
            )}

            {/* 模型上下文认主内置引擎:它在那边是真参数(喂给引擎的 -c);
                          LM Studio 的锅归 LM Studio 管,App 只信探测,这边连框都不给 —— 免得填个数
                          和那边打架 */}
            {draftConfig.provider === 'builtin' && (
              <>
                <div className="cfg-field-head">
                  <label htmlFor="cfg-context-size">模型上下文</label>
                  <span>tokens · 留空自动探测</span>
                </div>
                <div className="cfg-path-input">
                  <TreeIcon name="gauge" size={13} mono />
                  <input
                    id="cfg-context-size"
                    inputMode="numeric"
                    value={contextRaw}
                    placeholder={`自动向模型服务探测(探测不到按 ${DEFAULT_CONTEXT_SIZE} 算)`}
                    onChange={(e) => {
                      // 第八十九锤:打字时只挡非数字,大小不拦 —— 夹紧挪到失焦/保存那一刻
                      setContextRaw(e.target.value.replace(/[^0-9]/g, ''))
                    }}
                    onBlur={onContextBlur}
                  />
                </div>
                <p className="cfg-field-help">
                  模型一次能读多少字。功能定位的地图、干活报告、回复长度的预算都按它按比例算 ——
                  换大模型自动多喂,换小模型自动省着用。 范围 512 ~
                  1048576;打错了不用怕,点到别处或保存时自动归到最近的合法数;清空 = 交回自动探测。
                </p>
                {/* 档位滑块(2026-09-13):程序员档位一拨就填好,刻度也能直接点;拖动 = 切到手动档 */}
                {contextNotches.length > 0 && (
                  <div className="cfg-ctx-notch">
                    <div className="cfg-ctx-range">
                      <input
                        type="range"
                        min={0}
                        max={contextNotches.length - 1}
                        step={1}
                        value={ctxNotchIndex}
                        aria-label="模型上下文档位滑块"
                        onChange={(e) => commitContextValue(contextNotches[Number(e.target.value)])}
                      />
                    </div>
                    <div className="cfg-ctx-ticks">
                      {contextNotches.map((n, i) => (
                        <button
                          key={n}
                          type="button"
                          className={i === ctxNotchIndex ? 'is-active' : ''}
                          title={`${n.toLocaleString('en-US')} tokens`}
                          onClick={() => commitContextValue(n)}
                        >
                          {n / 1024}k
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {ctxInfo?.nativeContext != null && (
                  <p className="cfg-field-help">
                    这台模型的出厂上限是 {ctxInfo.nativeContext.toLocaleString('en-US')}{' '}
                    tokens,滑块到顶就是它 —— 再往上模型自己也记不住前文,不设这个档。
                  </p>
                )}
                {/* 黑板账单:拖一下滑块/改一个字就重新报一次价,扛不住当场喊,不等人白等 */}
                {ctxBill && (
                  <p className={`cfg-field-help cfg-fit-note is-${ctxBill.level}`}>
                    {ctxBill.level === 'ok' ? '✓' : ctxBill.level === 'unknown' ? '…' : '!'}{' '}
                    {ctxBill.text}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Developer 日志(第八十七锤):模型后台原话的常设入口,不用展开高级面板就够得着 */}
      <div className="cfg-devlog-row">
        <button
          type="button"
          className="cfg-devlog-btn"
          onClick={() => void window.atlas.devLogsOpen()}
        >
          <TreeIcon name="monitor" size={13} mono />
          打开后台日志
        </button>
        <p className="cfg-field-help">
          Developer 日志:引擎原话、每笔请求的报账、应用的记账,全在一本账里 ——
          模型在干嘛、卡在哪,开窗就知道。
        </p>
      </div>

      <div className="cfg-versions">
        <span className="cfg-versions-label">
          <TreeIcon name="info" size={12} mono />
          版本
        </span>
        <span className="mono">
          CodeAtlas {appVersion ?? '…'} · Electron {window.atlas.versions.electron()} · Node{' '}
          {window.atlas.versions.node()} · Chromium {window.atlas.versions.chrome()}
        </span>
      </div>

      <div className="cfg-summary">
        <span className="cfg-summary-icon">
          <TreeIcon name="sparkles" size={14} mono />
        </span>
        <div>
          <strong>当前配置</strong>
          <p>
            {themeName} · {Math.round(draftScale * 100)}% ·{' '}
            {isBuiltin ? '内置模型 本机直跑' : 'LM Studio 外部服务'} · 联网查证
            {draftConfig?.webLookup ? '已开启' : '关闭'}
          </p>
        </div>
        <span className={`cfg-summary-state${dirty ? ' is-dirty' : ''}`}>
          <TreeIcon name={dirty ? 'refresh' : 'check'} size={12} mono />
          {dirty ? '待应用' : '已同步'}
        </span>
      </div>
    </section>
  )
}
