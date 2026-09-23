import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AiConfig, ModelContextInfo, ModelFitVerdict } from '@shared/types'
import { CONTEXT_NOTCHES, FALLBACK_CONTEXT_CAP, formatContextBill } from '@shared/contextBill'
import { CONTEXT_SIZE_MAX, CONTEXT_SIZE_MIN, DEFAULT_CONTEXT_SIZE, DEFAULT_LMSTUDIO_BASE_URL } from '@shared/aiDefaults'
import { SCALE_MAX, SCALE_MIN } from '@shared/uiScale'
import {
  CUSTOM_MAX,
  DEFAULT_PERSONALIZATION,
  TEACHING_OPTIONS,
  TONE_OPTIONS,
  type PersonalizationConfig
} from '@shared/personalization'
import { looksLikeTavilyKey, tavilyUsageText, type TavilyProbeResult } from '@shared/tavily'
import { applyAppearance, COLOR_PRESETS, isDarkNow, loadAppearance, saveAppearance, type Appearance, type AppearanceMode, type AppearancePreset } from '../appearance'
import { friendlyErr } from '../errText'
import { TreeIcon } from './Icons'
import { ModelShelfPanel } from './ModelShelfPanel.tsx'

/** 「测一下」的结论文案(2026-09-17):Tavily 给的状态码翻成人话,别让用户对着码猜。
 *  结论是「能用」时随身报本月用量(2026-09-17 小葵提议:/usage 零成本捎带的) */
function probeText(result: TavilyProbeResult): { cls: string; text: string } {
  switch (result.verdict) {
    case 'ok':
      return {
        cls: 'is-ok',
        text: result.usage
          ? `这个 Key 能用 · ${tavilyUsageText(result.usage)}。联网搜索会走 Tavily 打头。`
          : '这个 Key 能用,联网搜索会走 Tavily 打头。'
      }
    case 'bad-key':
      return { cls: 'is-bad', text: 'Tavily 不认这个 Key:可能抄漏了一段,也可能这个 Key 被删了。' }
    case 'quota':
      return { cls: 'is-warn', text: 'Key 是对的,但这个月的搜索额度用完了(免费档每月 1000 次,下个月自动回血)。' }
    case 'busy':
      return { cls: 'is-warn', text: 'Tavily 说请求太频繁,过一会儿再测。' }
    case 'server':
      return { cls: 'is-warn', text: `Tavily 那边自己出状况了(状态码 ${result.status ?? '?'}),等会儿再试。` }
    case 'unreachable':
      return { cls: 'is-bad', text: '连不上 Tavily:检查网络或代理 —— 这不一定是 Key 的问题。' }
    default:
      return { cls: 'is-warn', text: `没测出结论(状态码 ${result.status ?? '?'}):回应看不懂,可能网络被中间拦了。` }
  }
}

/**
 * Tavily Key 输入块(2026-09-17):可选的搜索加速 Key —— 小眼睛看明文、「测一下」真打官方接口验货、
 * 形状不像 tvly- 开头给黄字提醒但**不拦**(将来 Tavily 改格式或用户走中转,硬拦会把人挡门外)。
 * 自成一小块:眼睛和体检结果都是它自己的事,不占大弹窗的状态位;结论随身带着被测的那把 Key,
 * 框里字一改旧结论自动作废,不用手动清。
 */
function TavilyKeyField({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const [probe, setProbe] = useState<{ key: string; result: TavilyProbeResult | null; busy: boolean; err: string | null }>({
    key: '',
    result: null,
    busy: false,
    err: null
  })
  const draft = value.trim()
  const shapeOdd = draft !== '' && !looksLikeTavilyKey(draft)
  const fresh = probe.key === draft
  const line = fresh && probe.result ? probeText(probe.result) : null
  const errLine = fresh ? probe.err : null

  async function test(): Promise<void> {
    if (draft === '' || probe.busy) return
    setProbe({ key: draft, result: null, busy: true, err: null })
    try {
      const result = await window.atlas.aiTestTavily(draft)
      setProbe({ key: draft, result, busy: false, err: null })
    } catch (err) {
      setProbe({ key: draft, result: null, busy: false, err: friendlyErr(err) })
    }
  }

  return (
    <div className="cfg-tavily-block">
      <div className="cfg-field-head">
        <label htmlFor="cfg-tavily-key">Tavily 搜索 Key(可选)</label>
        <span>填了搜索更快更稳</span>
      </div>
      <div className="cfg-path-input">
        <TreeIcon name="globe" size={13} mono />
        <input
          id="cfg-tavily-key"
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder="tvly- 开头;不填也能用(自动走免费源)"
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          title="拿这把 Key 查一次官方用量:验证 Key 有没有效,顺手报本月还剩多少次 —— 不花搜索额度"
          disabled={probe.busy || draft === ''}
          onClick={() => void test()}
        >
          {probe.busy ? '测试中…' : '测一下'}
        </button>
        <button
          type="button"
          className="cfg-eye-btn"
          aria-label={visible ? '隐藏 Key' : '显示 Key'}
          aria-pressed={visible}
          title={visible ? '隐藏' : '显示'}
          onClick={() => setVisible(!visible)}
        >
          <TreeIcon name={visible ? 'eyeOff' : 'eye'} size={13} mono />
        </button>
      </div>
      {shapeOdd && !line && !errLine && (
        <p className="cfg-field-help is-warn">提示:Tavily 的 Key 是 tvly- 开头的,这个看着不像 —— 存是能存,但多半用不上。</p>
      )}
      {(line || errLine) && <p className={`cfg-field-help ${line ? line.cls : 'is-bad'}`}>{line ? line.text : errLine}</p>}
      <p className="cfg-field-help">
        去 tavily.com 免费注册一个账号就能拿到(每月 1000 次搜索免费,不用绑卡)。Key 只存这台电脑的配置文件里,绝不进代码仓库。
      </p>
    </div>
  )
}

/** 档位下拉(第一百一十八锤补的语气下拉,讲解深度来了就泛化成通用款,照小葵的参考图):
 * 档名+介绍两行式 —— 原生 option 画不出两行,这一颗自己画。点外面或按 Esc 收起,选中项亮着。 */
function OptionSelect<K extends string>({
  options,
  value,
  onChange,
  ariaLabel
}: {
  options: Array<{ key: K; label: string; hint: string }>
  value: K
  onChange: (k: K) => void
  /** 列表弹开时的无障碍名:跟这行的 label 同名 */
  ariaLabel: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  const current = options.find((o) => o.key === value) ?? options[0]
  return (
    <div className="tone-select" ref={rootRef}>
      <button type="button" className="tone-select-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        {current.label}
        {/* 箭头照抄本文件图标册的 chevron(和其他控件同一颗),钉到最右;小葵点名加粗放大 */}
        <span className="tone-select-caret">
          <TreeIcon name="chevron" size={14} strokeWidth={4} mono />
        </span>
      </button>
      {open && (
        <div className="tone-select-list" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="option"
              aria-selected={o.key === value}
              className={`tone-select-item${o.key === value ? ' is-active' : ''}`}
              onClick={() => {
                onChange(o.key)
                setOpen(false)
              }}
            >
              <span className="tone-select-item-copy">
                <span className="tone-select-label">{o.label}</span>
                <span className="tone-select-hint">{o.hint}</span>
              </span>
              {o.key === value && (
                <span className="tone-select-tick" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
  const [fitCheck, setFitCheck] = useState<{ path: string; verdict: ModelFitVerdict | null }>({ path: '', verdict: null })
  // 上下文档位的账本原料(救生圈这锤):模型档案 + 机器家底,带着取数时的路径对号,
  // 路径一换旧结论自动作废 —— 不用在 effect 里手动清,也躲开「effect 里同步 setState」的坑
  const [ctxInfoFetched, setCtxInfoFetched] = useState<{ path: string; info: ModelContextInfo | null }>({ path: '', info: null })
  // 第八十九锤:上下文框的打字草稿(纯字符串,和存档里的数字分开管)
  const [contextRaw, setContextRaw] = useState<string>('')
  // 试一句的结果(第一百一十三锤):拿草稿试,没应用更改也能听
  const [sample, setSample] = useState<{ kind: 'busy' } | { kind: 'done'; text: string } | { kind: 'error'; text: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const appearanceRef = useRef<HTMLElement | null>(null)
  const aiRef = useRef<HTMLElement | null>(null)
  const personalRef = useRef<HTMLElement | null>(null)
  const advancedRef = useRef<HTMLElement | null>(null)

  // AI 配置只读一次存档;之后界面上的每一下都是草稿,应用更改才落盘
  useEffect(() => {
    void window.atlas.aiConfigGet()
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
    window.atlas.appVersion().then(setAppVersion).catch(() => {})
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

  // 视觉预览:草稿一变,界面当场变(还没落盘,撤销/关弹窗就退回)
  useEffect(() => {
    applyAppearance(draftAppearance)
  }, [draftAppearance])
  useEffect(() => {
    window.atlas.previewUiScale(draftScale)
  }, [draftScale])

  const appearanceDirty = JSON.stringify(draftAppearance) !== JSON.stringify(savedAppearance)
  const scaleDirty = draftScale !== savedScale
  const configDirty = savedConfig !== null && draftConfig !== null && JSON.stringify(draftConfig) !== JSON.stringify(savedConfig)
  // 第八十九锤:上下文框里没失焦的字也算草稿 —— 打了数还没点别处就关窗,照样弹「确认丢弃」
  const contextDirty = savedConfig !== null && clampContextSize(contextRaw) !== savedConfig.contextSize
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
        const toSave = committed === draftConfig.contextSize ? draftConfig : { ...draftConfig, contextSize: committed }
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
  }, [dirty, applyState.kind, draftAppearance, draftConfig, draftScale, contextRaw, onAiConfigSaved])

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
    setDraftScale((prev) => Math.round(Math.min(Math.max(prev + dir, SCALE_MIN), SCALE_MAX) * 100) / 100)
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
    if (picked) setDraftConfig({ ...draftConfig, builtin: { ...draftConfig.builtin, modelPath: picked } })
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
      return draftConfig.builtin.modelPath.trim() ? { ok: true, text: '已选择模型' } : { ok: false, text: '还没选模型' }
    }
    return draftConfig.lmstudio.baseUrl.trim() && draftConfig.lmstudio.model.trim() ? { ok: true, text: '已配置' } : { ok: false, text: '请填写地址并选择模型' }
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
      setSample(res.status === 'error' ? { kind: 'error', text: res.text } : { kind: 'done', text: res.text })
    } catch (err) {
      setSample({ kind: 'error', text: friendlyErr(err) })
    }
  }

  const footerState = (() => {
    if (applyState.kind === 'saving') return { tone: 'amber' as const, text: '正在保存……' }
    if (applyState.kind === 'error') return { tone: 'red' as const, text: applyState.text }
    if (dirty) return { tone: 'amber' as const, text: '有未应用的更改 —— 应用后生效,关闭前会先确认' }
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
            <button type="button" className="cfg-close" onClick={requestClose} aria-label="关闭设置">
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
                {activeSection === item.key && <span className="cfg-nav-marker" aria-hidden="true" />}
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
              <section
                className="cfg-section"
                ref={(el) => {
                  appearanceRef.current = el
                }}
              >
                <div className="cfg-section-head">
                  <div>
                    <span className="cfg-step">01</span>
                    <h3>外观与阅读</h3>
                  </div>
                  <span>影响整个工作区的显示方式</span>
                </div>
                <div className="cfg-panel">
                  <div className="cfg-row">
                    <div className="cfg-copy">
                      <label>亮还是暗</label>
                    </div>
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
                  </div>
                  <div className="cfg-divider" />
                  <div className="cfg-row">
                    <div className="cfg-copy">
                      <label>配色主题</label>
                      <p>选择一组在文件树、详情面板和状态信息中使用的颜色。换回任何预设会扔掉自定义色,两边不打架。</p>
                    </div>
                    <div className="cfg-themes">
                      {COLOR_PRESETS.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          className={`cfg-theme${draftAppearance.preset === p.key ? ' is-selected' : ''}`}
                          onClick={() => updateAppearance({ preset: p.key, accent: null, secondary: null })}
                        >
                          <span className="cfg-swatch" style={{ background: `linear-gradient(135deg, ${p.accent}, ${p.secondary})` }} />
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
                        <span className="cfg-swatch" style={{ background: `linear-gradient(135deg, ${previewAccent}, ${draftAppearance.secondary ?? defaultPreset.secondary})` }} />
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
                  </div>
                  {draftAppearance.preset === 'custom' && (
                    <>
                      <div className="cfg-divider" />
                      <div className="cfg-row">
                        <div className="cfg-copy">
                          <label>自定义颜色</label>
                          <p>主题色管按钮、选中这些主角色;辅助色管边框线、图标这些配角色;底板色管画布、面板染什么色调——只取颜色倾向,亮暗自动跟白天/黑夜走,选什么都不会翻车。</p>
                        </div>
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
                              onChange={(e) => updateAppearance({ preset: 'custom', secondary: e.target.value })}
                            />
                          </label>
                          <label className="cfg-color">
                            底板色
                            <input
                              type="color"
                              value={draftAppearance.base ?? (isDarkNow(draftAppearance) ? '#282828' : '#f6f6f6')}
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
                      </div>
                    </>
                  )}
                  <div className="cfg-divider" />
                  <div className="cfg-row">
                    <div className="cfg-copy">
                      <label>界面大小</label>
                      <p>调整文件树、标签和辅助文字的整体缩放。当前仅影响本机显示。</p>
                    </div>
                    <div className="cfg-scale">
                      <button type="button" className="cfg-stepper" aria-label="调小界面" onClick={() => stepScale(-0.05)} disabled={draftScale <= SCALE_MIN + 0.001}>
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
                      <button type="button" className="cfg-stepper" aria-label="调大界面" onClick={() => stepScale(0.05)} disabled={draftScale >= SCALE_MAX - 0.001}>
                        <TreeIcon name="plus" size={13} mono />
                      </button>
                      <output className="cfg-scale-value">{Math.round(scaleShown * 100)}%</output>
                    </div>
                  </div>
                </div>
              </section>

              {/* ── 02 个性化(小葵定的版式:挪到外观与阅读下面,智能辅助和高级选项这对 AI 配置连成一片) ── */}
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
                        <OptionSelect options={TONE_OPTIONS} value={personal.tone} onChange={(tone) => updatePersonal({ tone })} ariaLabel="基本风格和语气" />
                      </div>
                      <div className="cfg-divider" />
                      <div className="cfg-row">
                        <div className="cfg-copy">
                          <label>讲解深度</label>
                          <p>讲代码和文件时讲多细。「简洁」只说这东西是干什么的；「精简」先讲骨架、带几条名词小课堂；「详细」还会讲这门语言用到了哪些写法，并挑关键处展开（更耗算力，模型上下文太小时会自动退回精简，届时会明说）。</p>
                        </div>
                        <OptionSelect options={TEACHING_OPTIONS} value={personal.teaching} onChange={(teaching) => updatePersonal({ teaching })} ariaLabel="讲解深度" />
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
                          placeholder={'例如：告诉 AI 你的偏好、身份或回答风格，这些会在之后的对话中持续生效。'}
                          onChange={(e) => updatePersonal({ custom: e.target.value })}
                        />
                      </div>
                      <div className="cfg-privacy">
                        <TreeIcon name="shield" size={12} mono />
                        <span>自订指令只改说法,不改事实:不许编造、必须点名真实函数、看不出来的要明说 —— 这几条铁律不跟着变。</span>
                      </div>
                      <div className="cfg-divider" />
                      <div className="cfg-row cfg-row-stack">
                        <div className="cfg-copy">
                          <label>试一句</label>
                          <p>拿上面这套说法,让当前模型当场念一段小代码 —— 光看文字描述听不出语气,听一遍最准。用的是还没保存的草稿。</p>
                        </div>
                        <div className="cfg-sample-actions">
                          <button type="button" className="cfg-btn" onClick={() => void tryStyle()} disabled={sample?.kind === 'busy'}>
                            <TreeIcon name="sparkles" size={13} mono />
                            {sample?.kind === 'busy' ? '正在念……' : '试一句'}
                          </button>
                          {sample?.kind === 'done' && (
                            <button type="button" className="cfg-btn is-ghost" onClick={() => setSample(null)}>
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

              {/* ── 03 智能辅助 ── */}
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
                          <p>内置模型在本机运行。连接其他服务时,代码片段会发送到你填写的服务地址,请确认它值得信任。</p>
                        </div>
                        <div className="cfg-segmented">
                          <button type="button" className={!isBuiltin ? 'is-selected' : ''} onClick={() => setDraftConfig({ ...draftConfig, provider: 'lmstudio' })}>
                            <TreeIcon name="cloud" size={14} mono />
                            <span>
                              <strong>LM Studio</strong>
                              <small>外部服务</small>
                            </span>
                          </button>
                          <button type="button" className={isBuiltin ? 'is-selected' : ''} onClick={() => setDraftConfig({ ...draftConfig, provider: 'builtin' })}>
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
                            <span className={`cfg-flag${draftConfig.webLookup ? ' is-on' : ''}`}>{draftConfig.webLookup ? '已开启' : '默认关闭'}</span>
                          </label>
                          <p>讲解认不出某个软件/文件时,按「名字」查公开资料修正回答;对话翻文件模式里,模型也能自己上网查资料。发出去的只有搜索词,本地文件内容绝不出门。</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={draftConfig.webLookup}
                          aria-label="联网查证"
                          className={`cfg-switch${draftConfig.webLookup ? ' is-on' : ''}`}
                          onClick={() => setDraftConfig({ ...draftConfig, webLookup: !draftConfig.webLookup })}
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
                            <span className={`cfg-flag${chatSuggestionsOn ? ' is-on' : ''}`}>{chatSuggestionsOn ? '已开启' : '已关闭'}</span>
                          </label>
                          <p>
                            聊天框和文件预览的 AI 卡下面自动冒出的那排「可以问问看」,觉得问不上就关;关了也不再为猜这些问题白花模型的功夫。拨了马上生效,不用点应用更改。
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
                          查询链:填了 Tavily Key 则 Tavily 打头,之后 DuckDuckGo 公开页面 → 中文维基百科 → 英文维基百科;单次查询 5 秒超时,查不到就回退本地推测;查询结果只用于当前回答,不做任何其他用途。发出去的只有搜索词本身,不含本地路径和文件内容。
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>

              {/* ── 04 高级选项 ── */}
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
                      <small>{isBuiltin ? '推理引擎已内置,这里选大脑文件' : 'LM Studio 的服务地址与模型名'}</small>
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
                              onChange={(e) => setDraftConfig({ ...draftConfig, builtin: { ...draftConfig.builtin, modelPath: e.target.value } })}
                            />
                            <button type="button" onClick={() => void pickModel()}>
                              选择模型
                            </button>
                          </div>
                          <p className="cfg-field-help">模型是 AI 的大脑,一个独立文件;以后想换更强的 AI,换个模型文件就行。</p>
                          <div className="cfg-field-head">
                            <label>模型货架</label>
                            <span>实时榜单</span>
                          </div>
                          <button type="button" className="cfg-shelf-toggle" onClick={() => setShelfOpen((v) => !v)}>
                            <TreeIcon name={shelfOpen ? 'chevron' : 'sparkles'} size={13} mono />
                            {shelfOpen ? '收起货架' : '逛逛模型货架——实时热门 AI 模型榜,按大小挑,点开就能下'}
                          </button>
                          {shelfOpen && (
                            <ModelShelfPanel
                              onModelReady={() => {
                                // 下载完主进程已把配置写盘(Provider 切内置 + 模型路径指向新文件);
                                // 这儿重读一遍,让草稿和已存档都对着新现实,用户点「应用更改」也不会覆盖掉
                                void window.atlas.aiConfigGet().then((c) => {
                                  setSavedConfig(c)
                                  setDraftConfig(c)
                                  onAiConfigSaved?.(c)
                                })
                              }}
                            />
                          )}
                          {/* 量尺只替账单喊「文件不存在」这一嗓子(2026-09-18 小葵:两行黄字重复) ——
                              装得下/有点挤/装不下这些账,下面跟着滑条实时动的上下文账单都算,别报两遍 */}
                          {modelPathDraft.trim() && fitNote && fitNote.level === 'missing' && (
                            <p className="cfg-field-help cfg-fit-note is-missing">✕ {fitNote.title}:{fitNote.detail}</p>
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
                              onChange={(e) => setDraftConfig({ ...draftConfig, lmstudio: { ...draftConfig.lmstudio, baseUrl: e.target.value } })}
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
                              onChange={(e) => setDraftConfig({ ...draftConfig, lmstudio: { ...draftConfig.lmstudio, model: e.target.value } })}
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
                                  onClick={() => setDraftConfig({ ...draftConfig, lmstudio: { ...draftConfig.lmstudio, model: m } })}
                                >
                                  {m}
                                </button>
                              ))}
                            </div>
                          )}
                          {modelsNote && <p className="cfg-field-help is-warn">{modelsNote}</p>}
                          <p className="cfg-field-help">LM Studio 里开「开发者」本地服务,地址一般是 {DEFAULT_LMSTUDIO_BASE_URL}。</p>
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
                              onBlur={() => {
                                // 失焦落账:数字归到合法范围,空串交回自动探测;框里当场改字,眼见为实
                                const committed = clampContextSize(contextRaw)
                                setContextRaw(committed === undefined ? '' : String(committed))
                                if (draftConfig.contextSize !== committed) {
                                  setDraftConfig({ ...draftConfig, contextSize: committed })
                                }
                              }}
                            />
                          </div>
                          <p className="cfg-field-help">
                            模型一次能读多少字。功能定位的地图、干活报告、回复长度的预算都按它按比例算 —— 换大模型自动多喂,换小模型自动省着用。
                            范围 512 ~ 1048576;打错了不用怕,点到别处或保存时自动归到最近的合法数;清空 = 交回自动探测。
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
                              这台模型的出厂上限是 {ctxInfo.nativeContext.toLocaleString('en-US')} tokens,滑块到顶就是它 ——
                              再往上模型自己也记不住前文,不设这个档。
                            </p>
                          )}
                          {/* 黑板账单:拖一下滑块/改一个字就重新报一次价,扛不住当场喊,不等人白等 */}
                          {ctxBill && (
                            <p className={`cfg-field-help cfg-fit-note is-${ctxBill.level}`}>
                              {ctxBill.level === 'ok' ? '✓' : ctxBill.level === 'unknown' ? '…' : '!'} {ctxBill.text}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Developer 日志(第八十七锤):模型后台原话的常设入口,不用展开高级面板就够得着 */}
                <div className="cfg-devlog-row">
                  <button type="button" className="cfg-devlog-btn" onClick={() => void window.atlas.devLogsOpen()}>
                    <TreeIcon name="monitor" size={13} mono />
                    打开后台日志
                  </button>
                  <p className="cfg-field-help">Developer 日志:引擎原话、每笔请求的报账、应用的记账,全在一本账里 —— 模型在干嘛、卡在哪,开窗就知道。</p>
                </div>

                <div className="cfg-versions">
                  <span className="cfg-versions-label">
                    <TreeIcon name="info" size={12} mono />
                    版本
                  </span>
                  <span className="mono">
                    CodeAtlas {appVersion ?? '…'} · Electron {window.atlas.versions.electron()} · Node {window.atlas.versions.node()} · Chromium{' '}
                    {window.atlas.versions.chrome()}
                  </span>
                </div>

                <div className="cfg-summary">
                  <span className="cfg-summary-icon">
                    <TreeIcon name="sparkles" size={14} mono />
                  </span>
                  <div>
                    <strong>当前配置</strong>
                    <p>
                      {themeName} · {Math.round(draftScale * 100)}% · {isBuiltin ? '内置模型 本机直跑' : 'LM Studio 外部服务'} ·
                      联网查证{draftConfig?.webLookup ? '已开启' : '关闭'}
                    </p>
                  </div>
                  <span className={`cfg-summary-state${dirty ? ' is-dirty' : ''}`}>
                    <TreeIcon name={dirty ? 'refresh' : 'check'} size={12} mono />
                    {dirty ? '待应用' : '已同步'}
                  </span>
                </div>
              </section>
            </div>
          </section>
        </div>

        <footer className="cfg-foot">
          <div className={`cfg-foot-state is-${footerState.tone}`}>
            <TreeIcon name={footerState.tone === 'green' ? 'check' : 'refresh'} size={13} mono />
            {footerState.text}
          </div>
          <div className="cfg-foot-actions">
            <button type="button" className="cfg-btn-reset" onClick={revert} disabled={!dirty || applyState.kind === 'saving'}>
              <TreeIcon name="refresh" size={13} mono />
              恢复默认
            </button>
            <button type="button" className="cfg-btn-apply" onClick={() => void apply()} disabled={!dirty || applyState.kind === 'saving'}>
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
              <button type="button" className="cfg-btn-apply" autoFocus onClick={() => setConfirmDiscard(false)}>
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
