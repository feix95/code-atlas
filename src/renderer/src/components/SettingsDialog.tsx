import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AiConfig, ModelContextInfo, ModelFitVerdict } from '@shared/types'
import { CONTEXT_NOTCHES, FALLBACK_CONTEXT_CAP, formatContextBill } from '@shared/contextBill'
import { CONTEXT_SIZE_MAX, CONTEXT_SIZE_MIN, DEFAULT_CONTEXT_SIZE } from '@shared/aiDefaults'
import { SCALE_MAX, SCALE_MIN } from '@shared/uiScale'
import { DEFAULT_PERSONALIZATION, type PersonalizationConfig } from '@shared/personalization'
import {
  applyAppearance,
  COLOR_PRESETS,
  loadAppearance,
  saveAppearance,
  type Appearance
} from '../appearance'
import { friendlyErr } from '../errText'
import { TreeIcon } from './Icons'
import { SettingsAdvanced } from './SettingsAdvanced.tsx'
import { SettingsAi } from './SettingsAi.tsx'
import { SettingsAppearance } from './SettingsAppearance.tsx'
import { SettingsPersonal, type SampleState } from './SettingsPersonal.tsx'

// 界面大小范围/上下文合法范围的户口在 shared(uiScale.ts / aiDefaults.ts):
// 滑块档位、preload 根字号引擎、引擎 -c 归一化,三面同认一份

// 第八十九锤:模型上下文的合法范围。夹紧只发生在失焦/保存那一刻 —— 以前每敲一个键就夹,
// 8 当场变 512、删一个字又弹回 512,门卫跟手抢键盘,数根本输不进去也删不掉

/** 上下文输入框的落账规则:空串 = 交回自动探测(undefined);数字夹进合法范围 */
function clampContextSize(raw: string): number | undefined {
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits === '') return undefined
  return Math.max(CONTEXT_SIZE_MIN, Math.min(CONTEXT_SIZE_MAX, Number(digits)))
}

type SectionKey = 'appearance' | 'ai' | 'personal' | 'advanced'
type ApplyState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; text: string }

/** 设置侧栏「工作区偏好」组导航图标旋钮:四颗条目共享一个大小,跟别处互不相关 */
const NAV_ICON_SIZE = 18

const NAV_ITEMS: Array<{ key: SectionKey; icon: string; name: string; sub: string }> = [
  { key: 'appearance', icon: 'palette', name: '外观与阅读', sub: '配色与界面大小' },
  { key: 'personal', icon: 'sparkles', name: '个性化', sub: '语气与说话方式' },
  { key: 'ai', icon: 'bot', name: '智能辅助', sub: '模型与在线验证' },
  { key: 'advanced', icon: 'sliders', name: '高级选项', sub: '本地模型与连接详情' }
]

/**
 * 设置弹窗(按小葵的效果图重构):居中卡片 + 左侧导航 + 分区内容。
 * 逻辑是「暂存 + 预览 + 应用」:所有改动先进草稿、界面即时预览,
 * 点「应用更改」才落盘;恢复默认直接退回;关弹窗(×、Esc、点遮罩)在有未应用的更改时先弹确认,确认丢弃才退回。
 */
export function SettingsDialog({
  workspaceName,
  chatSuggestionsOn,
  onChatSuggestionsChange,
  onClose,
  initialSection = 'appearance',
  onAiConfigSaved
}: {
  workspaceName: string | null
  /** 推荐问题总闸(聊天偏好,App 端持有存档):这里只管拨开关,拨一下立刻生效落盘 */
  chatSuggestionsOn: boolean
  onChatSuggestionsChange: (v: boolean) => void
  onClose: () => void
  initialSection?: SectionKey
  onAiConfigSaved?: (config: AiConfig) => void
}): React.JSX.Element {
  const [savedAppearance, setSavedAppearance] = useState<Appearance>(loadAppearance)
  const [draftAppearance, setDraftAppearance] = useState<Appearance>(loadAppearance)
  const [savedConfig, setSavedConfig] = useState<AiConfig | null>(null)
  const [draftConfig, setDraftConfig] = useState<AiConfig | null>(null)
  const [savedScale, setSavedScale] = useState(() => window.atlas.getUiScale())
  const [draftScale, setDraftScale] = useState(() => window.atlas.getUiScale())
  const [applyState, setApplyState] = useState<ApplyState>({ kind: 'idle' })
  const [activeSection, setActiveSection] = useState<SectionKey>(initialSection)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [dragValue, setDragValue] = useState<number | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [modelsNote, setModelsNote] = useState<string | null>(null)
  const [modelsBusy, setModelsBusy] = useState(false)
  const [shelfOpen, setShelfOpen] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  // 量尺结果(第七十三锤):模型文件路径一变就问主进程「这台机器带得动吗」
  const [fitCheck, setFitCheck] = useState<{ path: string; verdict: ModelFitVerdict | null }>({
    path: '',
    verdict: null
  })
  // 上下文档位的账本原料(救生圈这锤):模型档案 + 机器家底,带着取数时的路径对号,
  // 路径一换旧结论自动作废 —— 不用在 effect 里手动清,也躲开「effect 里同步 setState」的坑
  const [ctxInfoFetched, setCtxInfoFetched] = useState<{
    path: string
    info: ModelContextInfo | null
  }>({ path: '', info: null })
  // 第八十九锤:上下文框的打字草稿(纯字符串,和存档里的数字分开管)
  const [contextRaw, setContextRaw] = useState<string>('')
  // 试一句的结果(第一百一十三锤):拿草稿试,没应用更改也能听
  const [sample, setSample] = useState<SampleState>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const appearanceRef = useRef<HTMLElement | null>(null)
  const aiRef = useRef<HTMLElement | null>(null)
  const personalRef = useRef<HTMLElement | null>(null)
  const advancedRef = useRef<HTMLElement | null>(null)

  // AI 配置只读一次存档;之后界面上的每一下都是草稿,应用更改才落盘
  useEffect(() => {
    void window.atlas
      .aiConfigGet()
      .then((c) => {
        setSavedConfig(c)
        setDraftConfig(c)
        // 第八十九锤:读档落定上下文框的初始字(打字草稿和存档数字分开管)
        setContextRaw(c.contextSize === undefined ? '' : String(c.contextSize))
      })
      .catch(() => {})
  }, [])

  const initialScrollRef = useRef(false)
  useEffect(() => {
    if (initialScrollRef.current || !draftConfig) return
    initialScrollRef.current = true
    requestAnimationFrame(() => {
      sectionEl(initialSection)?.scrollIntoView({ block: 'start', behavior: 'auto' })
    })
  }, [draftConfig, initialSection])

  // 版本信息行:CodeAtlas 版本号走 IPC,引擎三件套同步读 process.versions
  useEffect(() => {
    window.atlas
      .appVersion()
      .then(setAppVersion)
      .catch(() => {})
  }, [])

  // 量尺(第七十三锤) + 模型档案(档位账本):模型路径一变就都问一遍;
  // 结果带着路径入库,显示时按「取数路径 === 当前路径」对号,换人/清空自动失效
  const modelPathDraft = draftConfig?.builtin.modelPath ?? ''
  useEffect(() => {
    if (!modelPathDraft.trim()) return
    let alive = true
    void window.atlas
      .modelFitCheck(modelPathDraft)
      .then((v) => {
        if (alive) setFitCheck({ path: modelPathDraft, verdict: v })
      })
      .catch(() => {})
    void window.atlas
      .modelContextInfo(modelPathDraft)
      .then((v) => {
        if (alive) setCtxInfoFetched({ path: modelPathDraft, info: v })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [modelPathDraft])
  const fitNote = fitCheck.path === modelPathDraft ? fitCheck.verdict : null
  const ctxInfo = ctxInfoFetched.path === modelPathDraft ? ctxInfoFetched.info : null

  // ── 上下文档位滑块 + 黑板账单(2026-09-13 小葵拍的板)──
  // 滑块走程序员老规矩 2 的幂(4k/8k/16k/…);最大档照模型出厂上限封顶,翻不出档案按 64k 兜底;
  // 输入框自由填写照旧,两边随时互通;账单跟着框里现在的数实时算,扛不住当场喊。
  const contextNotches = useMemo(
    () => CONTEXT_NOTCHES.filter((n) => n <= (ctxInfo?.nativeContext ?? FALLBACK_CONTEXT_CAP)),
    [ctxInfo]
  )
  const committedCtx = clampContextSize(contextRaw)
  const ctxNotchIndex = useMemo(() => {
    const target = committedCtx ?? DEFAULT_CONTEXT_SIZE
    let best = 0
    for (let i = 1; i < contextNotches.length; i++) {
      if (Math.abs(contextNotches[i] - target) < Math.abs(contextNotches[best] - target)) best = i
    }
    return best
  }, [committedCtx, contextNotches])
  const ctxBill = useMemo(
    () =>
      ctxInfo
        ? formatContextBill({
            contextTokens: committedCtx ?? DEFAULT_CONTEXT_SIZE,
            isAuto: committedCtx === undefined,
            modelBytes: ctxInfo.sizeBytes,
            shape: ctxInfo.shape,
            ramBytes: ctxInfo.ramBytes,
            vramBytes: ctxInfo.vramBytes
          })
        : null,
    [ctxInfo, committedCtx]
  )
  function commitContextValue(v: number): void {
    setContextRaw(String(v))
    if (draftConfig && draftConfig.contextSize !== v) {
      setDraftConfig({ ...draftConfig, contextSize: v })
    }
  }

  /** 上下文输入框失焦落账:数字归到合法范围,空串交回自动探测;框里当场改字,眼见为实 */
  function onContextBlur(): void {
    const committed = clampContextSize(contextRaw)
    setContextRaw(committed === undefined ? '' : String(committed))
    if (draftConfig && draftConfig.contextSize !== committed) {
      setDraftConfig({ ...draftConfig, contextSize: committed })
    }
  }

  // 视觉预览:草稿一变,界面当场变(还没落盘,撤销/关弹窗就退回)
  useEffect(() => {
    applyAppearance(draftAppearance)
  }, [draftAppearance])
  useEffect(() => {
    window.atlas.previewUiScale(draftScale)
  }, [draftScale])

  const appearanceDirty = JSON.stringify(draftAppearance) !== JSON.stringify(savedAppearance)
  const scaleDirty = draftScale !== savedScale
  const configDirty =
    savedConfig !== null &&
    draftConfig !== null &&
    JSON.stringify(draftConfig) !== JSON.stringify(savedConfig)
  // 第八十九锤:上下文框里没失焦的字也算草稿 —— 打了数还没点别处就关窗,照样弹「确认丢弃」
  const contextDirty =
    savedConfig !== null && clampContextSize(contextRaw) !== savedConfig.contextSize
  const dirty = appearanceDirty || scaleDirty || configDirty || contextDirty

  const updateAppearance = useCallback((patch: Partial<Appearance>): void => {
    setDraftAppearance((prev) => ({ ...prev, ...patch }))
  }, [])

  /** 恢复默认 = 撤销未应用的更改,回到上次保存的样子(不碰已保存的存档) */
  const revert = useCallback((): void => {
    setDraftAppearance(savedAppearance)
    setDraftConfig(savedConfig)
    setDraftScale(savedScale)
    // 上下文框里没失焦的字也一并退回(存档没换人时上面那个回填不触发,这里手动退)
    setContextRaw(savedConfig?.contextSize === undefined ? '' : String(savedConfig.contextSize))
    setDragValue(null)
    setApplyState({ kind: 'idle' })
  }, [savedAppearance, savedConfig, savedScale])

  const apply = useCallback(async (): Promise<void> => {
    if (!dirty || applyState.kind === 'saving') return
    setApplyState({ kind: 'saving' })
    saveAppearance(draftAppearance)
    setSavedAppearance(draftAppearance)
    let errText: string | null = null
    if (draftConfig) {
      try {
        // 第八十九锤:兜键盘流的底 —— 点「应用更改」前如果框里还有没失焦的字,保存这一刻也夹进合法范围
        const committed = clampContextSize(contextRaw)
        const toSave =
          committed === draftConfig.contextSize
            ? draftConfig
            : { ...draftConfig, contextSize: committed }
        const saved = await window.atlas.aiConfigSave(toSave)
        setSavedConfig(saved)
        setDraftConfig(saved)
        onAiConfigSaved?.(saved)
        // 保存回写后框里照存档摆字(第八十九锤:存档换人的四个时刻之一)
        setContextRaw(saved.contextSize === undefined ? '' : String(saved.contextSize))
      } catch (err) {
        errText = friendlyErr(err)
      }
    }
    if (errText) {
      setApplyState({ kind: 'error', text: `外观已保存,但 AI 设置没存上:${errText}` })
      return
    }
    window.atlas.setUiScale(draftScale)
    setSavedScale(draftScale)
    setApplyState({ kind: 'idle' })
  }, [
    dirty,
    applyState.kind,
    draftAppearance,
    draftConfig,
    draftScale,
    contextRaw,
    onAiConfigSaved
  ])

  /** 关弹窗入口(遮罩/×/Esc 同路):保存中不响应;有草稿先弹确认,确认丢弃才真关 */
  const requestClose = useCallback((): void => {
    if (applyState.kind === 'saving') return
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    onClose()
  }, [applyState.kind, dirty, onClose])

  /** 确认丢弃:预览退回上次保存的样子,没应用的草稿当没改过 */
  const discardAndClose = useCallback((): void => {
    applyAppearance(savedAppearance)
    window.atlas.setUiScale(savedScale)
    onClose()
  }, [savedAppearance, savedScale, onClose])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      // 确认框开着时 Esc 等于「继续编辑」,别连着把设置也关了
      if (confirmDiscard) {
        setConfirmDiscard(false)
        return
      }
      requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose, confirmDiscard])

  function sectionEl(key: SectionKey): HTMLElement | null {
    if (key === 'appearance') return appearanceRef.current
    if (key === 'ai') return aiRef.current
    if (key === 'personal') return personalRef.current
    return advancedRef.current
  }

  /** 导航点击:滚到对应分区;滚动时反查当前该点亮哪一项 */
  function gotoSection(key: SectionKey): void {
    setActiveSection(key)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    sectionEl(key)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }

  function onNavScroll(): void {
    const el = scrollRef.current
    if (!el) return
    let current: SectionKey = 'appearance'
    for (const item of NAV_ITEMS) {
      const node = sectionEl(item.key)
      if (node && node.offsetTop - el.scrollTop <= 72) current = item.key
    }
    setActiveSection(current)
  }

  /** 滑条:拖动只挪滑条和读数(预览),松手才把数值写进草稿 */
  function commitDrag(): void {
    if (dragValue === null) return
    setDraftScale(dragValue)
    setDragValue(null)
  }

  function stepScale(dir: number): void {
    setDraftScale(
      (prev) => Math.round(Math.min(Math.max(prev + dir, SCALE_MIN), SCALE_MAX) * 100) / 100
    )
  }

  function enterCustom(): void {
    // 自定义永远跟着默认档走:不管当前选中哪个预设,种子一律是石墨的灰
    const base = COLOR_PRESETS[0]
    updateAppearance({
      preset: 'custom',
      accent: draftAppearance.accent ?? base.accent,
      secondary: draftAppearance.secondary ?? base.secondary
    })
  }

  async function listModels(): Promise<void> {
    if (!draftConfig) return
    setModelsBusy(true)
    setModelsNote(null)
    setModels([])
    try {
      const ids = await window.atlas.aiListModels(draftConfig.lmstudio.baseUrl)
      setModels(ids)
      if (ids.length === 0) setModelsNote('服务通了,但没列出模型 —— 先在 LM Studio 里加载一个。')
    } catch {
      setModelsNote('连不上这个地址,检查 LM Studio 是否已启动。')
    } finally {
      setModelsBusy(false)
    }
  }

  async function pickModel(): Promise<void> {
    if (!draftConfig) return
    const picked = await window.atlas.aiPickFile().catch(() => null)
    if (picked)
      setDraftConfig({ ...draftConfig, builtin: { ...draftConfig.builtin, modelPath: picked } })
  }

  /** 货架下载完主进程已把配置写盘(Provider 切内置 + 模型路径指向新文件);
   *  这儿重读一遍,让草稿和已存档都对着新现实,用户点「应用更改」也不会覆盖掉 */
  function onShelfModelReady(): void {
    void window.atlas.aiConfigGet().then((c) => {
      setSavedConfig(c)
      setDraftConfig(c)
      onAiConfigSaved?.(c)
    })
  }

  const presetDef = COLOR_PRESETS.find((p) => p.key === draftAppearance.preset) ?? COLOR_PRESETS[0]
  // 自定义卡(色点/pickers)的兜底永远是默认档,不跟当前预设跑 —— 自定义是「石墨底上自己调色」
  const defaultPreset = COLOR_PRESETS[0]
  const themeName = draftAppearance.preset === 'custom' ? '自定义' : presetDef.name
  const previewAccent = draftAppearance.accent ?? defaultPreset.accent
  const isBuiltin = draftConfig?.provider !== 'lmstudio'

  function sourceState(): { ok: boolean; text: string } {
    if (!draftConfig) return { ok: false, text: '读取中……' }
    if (draftConfig.provider === 'builtin') {
      return draftConfig.builtin.modelPath.trim()
        ? { ok: true, text: '已选择模型' }
        : { ok: false, text: '还没选模型' }
    }
    return draftConfig.lmstudio.baseUrl.trim() && draftConfig.lmstudio.model.trim()
      ? { ok: true, text: '已配置' }
      : { ok: false, text: '请填写地址并选择模型' }
  }
  const source = sourceState()
  const scaleShown = dragValue ?? draftScale

  // 说话方式(第一百一十三锤):草稿里没有就是全默认 —— 界面照默认摆
  const personal = draftConfig?.personalization ?? DEFAULT_PERSONALIZATION
  function updatePersonal(patch: Partial<PersonalizationConfig>): void {
    if (!draftConfig) return
    setDraftConfig({ ...draftConfig, personalization: { ...personal, ...patch } })
  }

  /**
   * 试一句(第一百一十三锤):拿当前草稿念一段,当场听说话方式的效果。
   * 故意走草稿而不是存档 —— 还没点「应用更改」就能试,不满意直接退回,不用先存再改。
   * 答完上一句之前再点不接(和别处的按钮一个规矩)。
   */
  async function tryStyle(): Promise<void> {
    if (!draftConfig || sample?.kind === 'busy') return
    setSample({ kind: 'busy' })
    try {
      const res = await window.atlas.aiStyleSample(personal)
      setSample(
        res.status === 'error'
          ? { kind: 'error', text: res.text }
          : { kind: 'done', text: res.text }
      )
    } catch (err) {
      setSample({ kind: 'error', text: friendlyErr(err) })
    }
  }

  const footerState = (() => {
    if (applyState.kind === 'saving') return { tone: 'amber' as const, text: '正在保存……' }
    if (applyState.kind === 'error') return { tone: 'red' as const, text: applyState.text }
    if (dirty)
      return { tone: 'amber' as const, text: '有未应用的更改 —— 应用后生效,关闭前会先确认' }
    return { tone: 'green' as const, text: '所有设置已同步' }
  })()

  return createPortal(
    <div className="cfg-layer">
      <div className="cfg-dim" onClick={requestClose} aria-hidden="true" />
      <main className="cfg-window" role="dialog" aria-modal="true" aria-label="设置">
        <header className="cfg-head">
          <div className="cfg-head-title">
            <span className="cfg-head-icon">
              <TreeIcon name="settings2" size={17} mono />
            </span>
            <div>
              <h1>设置</h1>
              <p>调整 CodeAtlas 的工作方式</p>
            </div>
          </div>
          <div className="cfg-head-actions">
            {dirty && (
              <span className="cfg-dirty-pill">
                <i aria-hidden="true" />
                有未保存的更改
              </span>
            )}
            <button
              type="button"
              className="cfg-close"
              onClick={requestClose}
              aria-label="关闭设置"
            >
              <TreeIcon name="x" size={15} mono />
            </button>
          </div>
        </header>

        <div className="cfg-body">
          <aside className="cfg-nav">
            <div className="cfg-nav-caption">工作区偏好</div>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`cfg-nav-item${activeSection === item.key ? ' is-active' : ''}`}
                onClick={() => gotoSection(item.key)}
              >
                <span className="cfg-nav-icon">
                  <TreeIcon name={item.icon} size={NAV_ICON_SIZE} mono />
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.sub}</small>
                </span>
                {activeSection === item.key && (
                  <span className="cfg-nav-marker" aria-hidden="true" />
                )}
              </button>
            ))}
            <div className="cfg-nav-rule" />
            <div className="cfg-nav-context">
              <span className="cfg-context-icon">
                <TreeIcon name="monitor" size={NAV_ICON_SIZE} mono />
              </span>
              <div>
                <strong>当前工作区</strong>
                <span>{workspaceName ?? '未打开项目'}</span>
              </div>
            </div>
            <div className="cfg-nav-footnote">
              <TreeIcon name="help" size={12} mono />
              设置会保存到本机
            </div>
          </aside>

          <section className="cfg-content">
            <div className="cfg-scroll" ref={scrollRef} onScroll={onNavScroll}>
              <div className="cfg-intro">
                <div>
                  <div className="cfg-eyebrow">WORKSPACE CONFIGURATION</div>
                  <h2>让阅读代码更像你的节奏</h2>
                  <p>配色、界面大小到 AI 辅助来源,改动立即预览,点「应用更改」后才真正生效。</p>
                </div>
                <span className={`cfg-live-status${dirty ? ' is-dirty' : ''}`}>
                  <i aria-hidden="true" />
                  {dirty ? '预览中 · 待应用' : '配置预览中'}
                </span>
              </div>

              {/* ── 01 外观与阅读 ── */}
              <SettingsAppearance
                appearanceRef={appearanceRef}
                draftAppearance={draftAppearance}
                updateAppearance={updateAppearance}
                enterCustom={enterCustom}
                previewAccent={previewAccent}
                defaultPreset={defaultPreset}
                draftScale={draftScale}
                scaleShown={scaleShown}
                setDragValue={setDragValue}
                commitDrag={commitDrag}
                stepScale={stepScale}
              />

              {/* ── 02 个性化(小葵定的版式:挪到外观与阅读下面,智能辅助和高级选项这对 AI 配置连成一片) ── */}
              <SettingsPersonal
                personalRef={personalRef}
                draftConfig={draftConfig}
                personal={personal}
                updatePersonal={updatePersonal}
                sample={sample}
                setSample={setSample}
                tryStyle={tryStyle}
              />

              {/* ── 03 智能辅助 ── */}
              <SettingsAi
                aiRef={aiRef}
                draftConfig={draftConfig}
                setDraftConfig={setDraftConfig}
                isBuiltin={isBuiltin}
                source={source}
                chatSuggestionsOn={chatSuggestionsOn}
                onChatSuggestionsChange={onChatSuggestionsChange}
                privacyOpen={privacyOpen}
                setPrivacyOpen={setPrivacyOpen}
              />

              {/* ── 04 高级选项 ── */}
              <SettingsAdvanced
                advancedRef={advancedRef}
                draftConfig={draftConfig}
                setDraftConfig={setDraftConfig}
                isBuiltin={isBuiltin}
                pickModel={pickModel}
                shelfOpen={shelfOpen}
                setShelfOpen={setShelfOpen}
                onShelfModelReady={onShelfModelReady}
                modelPathDraft={modelPathDraft}
                fitNote={fitNote}
                models={models}
                modelsBusy={modelsBusy}
                modelsNote={modelsNote}
                listModels={listModels}
                contextRaw={contextRaw}
                setContextRaw={setContextRaw}
                onContextBlur={onContextBlur}
                contextNotches={contextNotches}
                ctxNotchIndex={ctxNotchIndex}
                commitContextValue={commitContextValue}
                ctxInfo={ctxInfo}
                ctxBill={ctxBill}
                appVersion={appVersion}
                themeName={themeName}
                draftScale={draftScale}
                dirty={dirty}
              />
            </div>
          </section>
        </div>

        <footer className="cfg-foot">
          <div className={`cfg-foot-state is-${footerState.tone}`}>
            <TreeIcon name={footerState.tone === 'green' ? 'check' : 'refresh'} size={13} mono />
            {footerState.text}
          </div>
          <div className="cfg-foot-actions">
            <button
              type="button"
              className="cfg-btn-reset"
              onClick={revert}
              disabled={!dirty || applyState.kind === 'saving'}
            >
              <TreeIcon name="refresh" size={13} mono />
              恢复默认
            </button>
            <button
              type="button"
              className="cfg-btn-apply"
              onClick={() => void apply()}
              disabled={!dirty || applyState.kind === 'saving'}
            >
              <TreeIcon name="save" size={13} mono />
              {applyState.kind === 'saving' ? '应用中……' : '应用更改'}
            </button>
          </div>
        </footer>
      </main>

      {confirmDiscard && (
        <div className="cfg-confirm-dim" onClick={() => setConfirmDiscard(false)}>
          <div
            className="cfg-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cfg-confirm-title"
            aria-describedby="cfg-confirm-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="cfg-confirm-title">未应用的更改</h2>
            <p id="cfg-confirm-desc">关闭设置将丢弃这些更改,并恢复为上次保存的状态。</p>
            <div className="cfg-confirm-actions">
              <button type="button" className="cfg-btn-reset" onClick={discardAndClose}>
                丢弃并关闭
              </button>
              <button
                type="button"
                className="cfg-btn-apply"
                autoFocus
                onClick={() => setConfirmDiscard(false)}
              >
                继续编辑
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
