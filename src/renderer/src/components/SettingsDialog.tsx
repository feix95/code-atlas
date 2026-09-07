import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AiConfig } from '@shared/types'
import { applyAppearance, COLOR_PRESETS, loadAppearance, saveAppearance, type Appearance, type AppearanceMode, type AppearancePreset } from '../appearance'
import { friendlyErr } from '../errText'

// 界面大小范围(跟根字号缩放引擎配套):80% ~ 180%
const SCALE_MIN = 0.8
const SCALE_MAX = 1.8

type SectionKey = 'appearance' | 'ai' | 'advanced'
type ApplyState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; text: string }

/** 效果图同款线性小图标(lucide 线条),随字号一起缩放 */
const ICON_PATHS: Record<string, ReactNode> = {
  settings2: (
    <>
      <path d="M14 17H5" />
      <path d="M19 7h-9" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>
  ),
  palette: (
    <>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.6-1.7h2c3 0 5.6-2.5 5.6-5.6C22 6 17.5 2 12 2z" />
    </>
  ),
  bot: (
    <>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </>
  ),
  gauge: (
    <>
      <path d="M12 15l3.5-3.5" />
      <path d="M20.2 15.5a8.5 8.5 0 1 0-16.4 0" />
    </>
  ),
  sliders: (
    <>
      <line x1="21" x2="14" y1="4" y2="4" />
      <line x1="10" x2="3" y1="4" y2="4" />
      <line x1="21" x2="12" y1="12" y2="12" />
      <line x1="8" x2="3" y1="12" y2="12" />
      <line x1="21" x2="16" y1="20" y2="20" />
      <line x1="12" x2="3" y1="20" y2="20" />
      <line x1="14" x2="14" y1="2" y2="6" />
      <line x1="8" x2="8" y1="10" y2="14" />
      <line x1="16" x2="16" y1="18" y2="22" />
    </>
  ),
  monitor: (
    <>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z" />,
  drive: (
    <>
      <line x1="22" x2="2" y1="12" y2="12" />
      <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" />
      <line x1="6" x2="6.01" y1="16" y2="16" />
      <line x1="10" x2="10.01" y1="16" y2="16" />
    </>
  ),
  shield: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  rotate: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  save: (
    <>
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
      <path d="M7 3v4a1 1 0 0 0 1 1h7" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  circleCheck: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  sparkles: (
    <path d="M9.9 15.5a2 2 0 0 0-1.4-1.4l-6.1-1.6a.5.5 0 0 1 0-1L8.5 9.9A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0L14.1 8.5a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  folder: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
}

function Icon({ name, size = 15 }: { name: string; size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  )
}

const MODES: Array<{ key: AppearanceMode; name: string }> = [
  { key: 'auto', name: '跟随系统' },
  { key: 'light', name: '白天' },
  { key: 'dark', name: '黑夜' }
]

const THEME_SUB: Record<AppearancePreset, string> = {
  default: '默认',
  teal: '低对比',
  violet: '柔和',
  custom: '手动调整'
}

const NAV_ITEMS: Array<{ key: SectionKey; icon: string; name: string; sub: string }> = [
  { key: 'appearance', icon: 'palette', name: '外观与阅读', sub: '配色与界面大小' },
  { key: 'ai', icon: 'bot', name: '智能辅助', sub: '模型与在线验证' },
  { key: 'advanced', icon: 'sliders', name: '高级选项', sub: '本地模型与连接详情' }
]

/**
 * 设置弹窗(按小葵的效果图重构):居中卡片 + 左侧导航 + 分区内容。
 * 逻辑是「暂存 + 预览 + 应用」:所有改动先进草稿、界面即时预览,
 * 点「应用更改」才落盘;恢复默认直接退回;关弹窗(×、Esc、点遮罩)在有未应用的更改时先弹确认,确认丢弃才退回。
 */
export function SettingsDialog({ workspaceName, onClose }: { workspaceName: string | null; onClose: () => void }): React.JSX.Element {
  const [savedAppearance, setSavedAppearance] = useState<Appearance>(loadAppearance)
  const [draftAppearance, setDraftAppearance] = useState<Appearance>(loadAppearance)
  const [savedConfig, setSavedConfig] = useState<AiConfig | null>(null)
  const [draftConfig, setDraftConfig] = useState<AiConfig | null>(null)
  const [savedScale, setSavedScale] = useState(() => window.atlas.getUiScale())
  const [draftScale, setDraftScale] = useState(() => window.atlas.getUiScale())
  const [applyState, setApplyState] = useState<ApplyState>({ kind: 'idle' })
  const [activeSection, setActiveSection] = useState<SectionKey>('appearance')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [dragValue, setDragValue] = useState<number | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [modelsNote, setModelsNote] = useState<string | null>(null)
  const [modelsBusy, setModelsBusy] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const appearanceRef = useRef<HTMLElement | null>(null)
  const aiRef = useRef<HTMLElement | null>(null)
  const advancedRef = useRef<HTMLElement | null>(null)

  // AI 配置只读一次存档;之后界面上的每一下都是草稿,应用更改才落盘
  useEffect(() => {
    void window.atlas.aiConfigGet()
      .then((c) => {
        setSavedConfig(c)
        setDraftConfig(c)
      })
      .catch(() => {})
  }, [])

  // 版本信息行:CodeAtlas 版本号走 IPC,引擎三件套同步读 process.versions
  useEffect(() => {
    window.atlas.appVersion().then(setAppVersion).catch(() => {})
  }, [])

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
  const dirty = appearanceDirty || scaleDirty || configDirty

  const updateAppearance = useCallback((patch: Partial<Appearance>): void => {
    setDraftAppearance((prev) => ({ ...prev, ...patch }))
  }, [])

  /** 恢复默认 = 撤销未应用的更改,回到上次保存的样子(不碰已保存的存档) */
  const revert = useCallback((): void => {
    setDraftAppearance(savedAppearance)
    setDraftConfig(savedConfig)
    setDraftScale(savedScale)
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
        const saved = await window.atlas.aiConfigSave(draftConfig)
        setSavedConfig(saved)
        setDraftConfig(saved)
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
  }, [dirty, applyState.kind, draftAppearance, draftConfig, draftScale])

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
    for (const key of ['appearance', 'ai', 'advanced'] as SectionKey[]) {
      const node = sectionEl(key)
      if (node && node.offsetTop - el.scrollTop <= 72) current = key
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
    const base = COLOR_PRESETS.find((p) => p.key === draftAppearance.preset) ?? COLOR_PRESETS[0]
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
  const themeName = draftAppearance.preset === 'custom' ? '自定义' : presetDef.name
  const previewAccent = draftAppearance.accent ?? presetDef.accent
  const isBuiltin = draftConfig?.provider !== 'lmstudio'

  function sourceState(): { ok: boolean; text: string } {
    if (!draftConfig) return { ok: false, text: '读取中……' }
    if (draftConfig.provider === 'builtin') {
      return draftConfig.builtin.modelPath ? { ok: true, text: '已就绪' } : { ok: false, text: '还没选模型' }
    }
    return draftConfig.lmstudio.baseUrl ? { ok: true, text: '已配置' } : { ok: false, text: '还没填地址' }
  }
  const source = sourceState()
  const scaleShown = dragValue ?? draftScale

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
              <Icon name="settings2" size={17} />
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
              <Icon name="x" size={15} />
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
                  <Icon name={item.icon} size={14} />
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
                <Icon name="monitor" size={13} />
              </span>
              <div>
                <strong>当前工作区</strong>
                <span>{workspaceName ?? '未打开项目'}</span>
              </div>
            </div>
            <div className="cfg-nav-footnote">
              <Icon name="question" size={12} />
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
                      <p>选「跟随系统」就跟 Windows 的深浅色一起换;想固定住就点「白天」或「黑夜」。</p>
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
                              <Icon name="check" size={12} />
                            </span>
                          )}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`cfg-theme${draftAppearance.preset === 'custom' ? ' is-selected' : ''}`}
                        onClick={enterCustom}
                      >
                        <span className="cfg-swatch" style={{ background: `linear-gradient(135deg, ${previewAccent}, ${draftAppearance.secondary ?? presetDef.secondary})` }} />
                        <span>
                          <strong>自定义</strong>
                          <small>{THEME_SUB.custom}</small>
                        </span>
                        {draftAppearance.preset === 'custom' && (
                          <span className="cfg-theme-check">
                            <Icon name="check" size={12} />
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
                          <p>主题色管按钮、选中这些主角色;辅助色管边框线、图标这些配角色。</p>
                        </div>
                        <div className="cfg-colors">
                          <label className="cfg-color">
                            主题色
                            <input
                              type="color"
                              value={draftAppearance.accent ?? presetDef.accent}
                              onChange={(e) => updateAppearance({ preset: 'custom', accent: e.target.value })}
                            />
                          </label>
                          <label className="cfg-color">
                            辅助色
                            <input
                              type="color"
                              value={draftAppearance.secondary ?? presetDef.secondary}
                              onChange={(e) => updateAppearance({ preset: 'custom', secondary: e.target.value })}
                            />
                          </label>
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
                        <Icon name="minus" size={13} />
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
                        <Icon name="plus" size={13} />
                      </button>
                      <output className="cfg-scale-value">{Math.round(scaleShown * 100)}%</output>
                    </div>
                  </div>
                  <div className="cfg-preview-strip">
                    <span className="cfg-preview-label">
                      <Icon name="eye" size={12} />
                      实时预览
                    </span>
                    <span className="cfg-mini" style={{ '--preview-accent': previewAccent } as CSSProperties}>
                      <i className="cfg-mini-dot" />
                      <i className="cfg-mini-line-long" />
                      <i className="cfg-mini-line" />
                      <em>App.tsx</em>
                    </span>
                    <span className="cfg-preview-note">界面文字将以 {Math.round(scaleShown * 100)}% 比例显示</span>
                  </div>
                </div>
              </section>

              {/* ── 02 智能辅助 ── */}
              <section
                className="cfg-section"
                ref={(el) => {
                  aiRef.current = el
                }}
              >
                <div className="cfg-section-head">
                  <div>
                    <span className="cfg-step">02</span>
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
                          <p>两种来源都在本机跑:LM Studio 连你自己的服务端口,内置模型直接加载本地文件,代码不出电脑。</p>
                        </div>
                        <div className="cfg-segmented">
                          <button type="button" className={!isBuiltin ? 'is-selected' : ''} onClick={() => setDraftConfig({ ...draftConfig, provider: 'lmstudio' })}>
                            <Icon name="cloud" size={14} />
                            <span>
                              <strong>LM Studio</strong>
                              <small>外部服务</small>
                            </span>
                          </button>
                          <button type="button" className={isBuiltin ? 'is-selected' : ''} onClick={() => setDraftConfig({ ...draftConfig, provider: 'builtin' })}>
                            <Icon name="drive" size={14} />
                            <span>
                              <strong>内置模型</strong>
                              <small>本机直跑</small>
                            </span>
                          </button>
                        </div>
                      </div>
                      <div className="cfg-callout">
                        <span className="cfg-callout-icon">
                          <Icon name={isBuiltin ? 'drive' : 'cloud'} size={13} />
                        </span>
                        <div>
                          <strong>{isBuiltin ? '使用内置模型(本机直跑)' : '使用 LM Studio(外部服务)'}</strong>
                          <p>
                            {isBuiltin
                              ? '推理引擎已内置,模型文件就是 AI 的大脑;分析全程不出本机,复杂项目的首次响应可能要等模型加载。'
                              : '需要先在本机启动 LM Studio 并加载好模型;代码片段只会发往你填的本地端口,不会离开你的设备。'}
                          </p>
                        </div>
                        <span className={`cfg-callout-state${source.ok ? '' : ' is-warn'}`}>
                          <Icon name={source.ok ? 'circleCheck' : 'question'} size={12} />
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
                          <p>讲解认不出某个软件/文件时,允许按「名字」查公开资料来修正回答。</p>
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
                      <div className="cfg-privacy">
                        <Icon name="shield" size={12} />
                        <span>仅发送认不出的「名字」,绝不发送文件夹路径或文件内容;不开启则完全离线。</span>
                        <button type="button" onClick={() => setPrivacyOpen(!privacyOpen)}>
                          {privacyOpen ? '收起' : '查看数据范围'}
                          <Icon name="chevron" size={11} />
                        </button>
                      </div>
                      {privacyOpen && (
                        <div className="cfg-privacy-more">
                          查询链:中文维基百科 → 英文维基百科 → DuckDuckGo 公开页面;单次查询 5 秒超时,查不到就回退本地推测;查询结果只用于当前回答,不做任何其他用途。
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>

              {/* ── 03 高级选项 ── */}
              <section
                className="cfg-section"
                ref={(el) => {
                  advancedRef.current = el
                }}
              >
                <div className="cfg-section-head">
                  <div>
                    <span className="cfg-step">03</span>
                    <h3>高级选项</h3>
                  </div>
                  <span>按需展开,减少意外修改</span>
                </div>
                <div className={`cfg-panel cfg-advanced${advancedOpen ? ' is-open' : ''}`}>
                  <button type="button" className="cfg-advanced-trigger" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>
                    <span className="cfg-advanced-icon">
                      <Icon name="sliders" size={13} />
                    </span>
                    <span>
                      <strong>本地模型连接</strong>
                      <small>{isBuiltin ? '推理引擎已内置,这里选大脑文件' : 'LM Studio 的服务地址与模型名'}</small>
                    </span>
                    <span className="cfg-chevron">
                      <Icon name="chevron" size={14} />
                    </span>
                  </button>
                  {advancedOpen && draftConfig && (
                    <div className="cfg-advanced-body">
                      {isBuiltin ? (
                        <>
                          <div className="cfg-field-head">
                            <label htmlFor="cfg-model-path">模型文件</label>
                            <span>GGUF</span>
                          </div>
                          <div className="cfg-path-input">
                            <Icon name="folder" size={13} />
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
                        </>
                      ) : (
                        <>
                          <div className="cfg-field-head">
                            <label htmlFor="cfg-baseurl">模型服务地址</label>
                            <span>LM Studio</span>
                          </div>
                          <div className="cfg-path-input">
                            <Icon name="cloud" size={13} />
                            <input
                              id="cfg-baseurl"
                              value={draftConfig.lmstudio.baseUrl}
                              placeholder="http://127.0.0.1:1234/v1"
                              onChange={(e) => setDraftConfig({ ...draftConfig, lmstudio: { ...draftConfig.lmstudio, baseUrl: e.target.value } })}
                            />
                          </div>
                          <div className="cfg-field-head">
                            <label htmlFor="cfg-model-name">模型名</label>
                            <span>点「读取模型」自动填</span>
                          </div>
                          <div className="cfg-path-input">
                            <Icon name="drive" size={13} />
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
                          <p className="cfg-field-help">LM Studio 里开「开发者」本地服务,地址一般是 http://127.0.0.1:1234/v1。</p>
                        </>
                      )}

                      <div className="cfg-field-head">
                        <label htmlFor="cfg-context-size">模型上下文</label>
                        <span>tokens · 留空自动探测</span>
                      </div>
                      <div className="cfg-path-input">
                        <Icon name="gauge" size={13} />
                        <input
                          id="cfg-context-size"
                          inputMode="numeric"
                          value={draftConfig.contextSize ?? ''}
                          placeholder="自动向模型服务探测(探测不到按 4096 算)"
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9]/g, '')
                            setDraftConfig({
                              ...draftConfig,
                              contextSize: raw === '' ? undefined : Math.max(512, Math.min(1_048_576, Number(raw)))
                            })
                          }}
                        />
                      </div>
                      <p className="cfg-field-help">模型一次能读多少字。功能定位的地图、干活报告、回复长度的预算都按它按比例算 —— 换大模型自动多喂,换小模型自动省着用。</p>
                    </div>
                  )}
                </div>

                <div className="cfg-versions">
                  <span className="cfg-versions-label">
                    <Icon name="info" size={12} />
                    版本
                  </span>
                  <span className="mono">
                    CodeAtlas {appVersion ?? '…'} · Electron {window.atlas.versions.electron()} · Node {window.atlas.versions.node()} · Chromium{' '}
                    {window.atlas.versions.chrome()}
                  </span>
                </div>

                <div className="cfg-summary">
                  <span className="cfg-summary-icon">
                    <Icon name="sparkles" size={14} />
                  </span>
                  <div>
                    <strong>当前配置</strong>
                    <p>
                      {themeName} · {Math.round(draftScale * 100)}% · {isBuiltin ? '内置模型 本机直跑' : 'LM Studio 外部服务'} ·
                      联网查证{draftConfig?.webLookup ? '已开启' : '关闭'}
                    </p>
                  </div>
                  <span className={`cfg-summary-state${dirty ? ' is-dirty' : ''}`}>
                    <Icon name={dirty ? 'rotate' : 'circleCheck'} size={12} />
                    {dirty ? '待应用' : '已同步'}
                  </span>
                </div>
              </section>
            </div>
          </section>
        </div>

        <footer className="cfg-foot">
          <div className={`cfg-foot-state is-${footerState.tone}`}>
            <Icon name={footerState.tone === 'green' ? 'circleCheck' : 'rotate'} size={13} />
            {footerState.text}
          </div>
          <div className="cfg-foot-actions">
            <button type="button" className="cfg-btn-reset" onClick={revert} disabled={!dirty || applyState.kind === 'saving'}>
              <Icon name="rotate" size={13} />
              恢复默认
            </button>
            <button type="button" className="cfg-btn-apply" onClick={() => void apply()} disabled={!dirty || applyState.kind === 'saving'}>
              <Icon name="save" size={13} />
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
