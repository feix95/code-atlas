import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiConfig, AiProviderKind, ModelContextInfo, ModelFitVerdict } from '@shared/types'
import { DEFAULT_PERSONALIZATION, type PersonalizationConfig } from '@shared/personalization'
import { CH } from '@shared/ipcChannels'
import type { SectionKey } from '../settingsNav'
import {
  applyAppearance,
  COLOR_PRESETS,
  loadAppearance,
  saveAppearance,
  type Appearance
} from '../appearance'
import { friendlyErr } from '../errText'
import { useConfigAutosave } from '../useConfigAutosave'
import { useContextBill } from '../useContextBill'
import { SettingsAbout } from './SettingsAbout.tsx'
import { SettingsAi } from './SettingsAi.tsx'
import { SettingsAppearance } from './SettingsAppearance.tsx'
import { SettingsNet } from './SettingsNet.tsx'

// 界面大小范围/上下文合法范围的登记在 shared(uiScale.ts / aiDefaults.ts):
// 滑块档位、preload 根字号引擎、引擎 -c 归一化,三面同认一份

// 模型上下文的合法范围。夹紧只发生在失焦那一刻 —— 以前每敲一个键就夹,
// 8 当场变 512、删一个字又弹回 512,门卫跟手抢键盘,数根本输不进去也删不掉

/** 上下文输入框的落账规则在 useContextBill */

export type { SectionKey }

/**
 * 设置页(UI v3 §6:SettingsDialog 弹窗退役,改成 rail 齿轮开的单例页签):
 * 左侧栏一项 = 右侧一整页(Obsidian 式,滚动翻节已退役),页键与导航共用 SectionKey。
 * 即改即存 —— Obsidian/VS Code 同款:控件每拨一下当场生效并落盘,
 * 文本输入的连击走 300ms 防抖聚成一笔;没有草稿状态表、没有页脚确认。
 * 页签被 × 掉/切走时组件卸载,没跑完的防抖落盘在卸载前冲线。
 * 页签本体由 PaneGroups 保活层托管(只藏不拆):切走再回来,页面状态原样还在。
 */
export function SettingsPage({
  workspaceName: _workspaceName, // 侧栏卡片摘除后暂无人读;props 登记保留,侧栏导航要用
  sectionReq,
  onAiConfigSaved,
  onSettingsSection
}: {
  workspaceName: string | null
  /** 「AI 设置」直达/侧栏导航点击:入口每点一次 seq +1,页内切到指定页(首屏也有用) */
  sectionReq?: { section: SectionKey; seq: number }
  onAiConfigSaved?: (config: AiConfig) => void
  /** 切页回报口:切到哪页就喊一声,侧栏导航跟着亮(App 持有那本账) */
  onSettingsSection?: (key: SectionKey) => void
}): React.JSX.Element {
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance)
  const { config, applyConfig, commitConfig, saveError } = useConfigAutosave(onAiConfigSaved)
  const [scale, setScale] = useState(() => window.atlas.getUiScale())
  // 当前分类的登记已上交 App(settingsSection):本页只领 sectionReq 跳转命令,自己不养导航状态表
  const [dragValue, setDragValue] = useState<number | null>(null)
  // 模型清单带着来源登记:LM Studio 与在线 API 各读各的,切来源后旧清单不串台
  const [models, setModels] = useState<{ provider: AiProviderKind; ids: string[] }>({
    provider: 'lmstudio',
    ids: []
  })
  const [modelsNote, setModelsNote] = useState<string | null>(null)
  const [modelsBusy, setModelsBusy] = useState(false)
  const [shelfOpen, setShelfOpen] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  // 适配估算结果:模型文件路径一变就问主进程「这台机器带得动吗」
  const [fitCheck, setFitCheck] = useState<{ path: string; verdict: ModelFitVerdict | null }>({
    path: '',
    verdict: null
  })
  // 上下文档位的状态表原料:模型档案 + 机器规格,带着取数时的路径对号,
  // 路径一换旧结论自动作废 —— 不用在 effect 里手动清,也躲开「effect 里同步 setState」的坑
  const [ctxInfoFetched, setCtxInfoFetched] = useState<{
    path: string
    info: ModelContextInfo | null
  }>({ path: '', info: null })
  // 当前页登记:侧栏导航发 sectionReq 翻页,这里只认 seq 切页
  const [page, setPage] = useState<SectionKey>('appearance')

  // 模型路径一变就重问适配估算与模型档案;显示时按「取数路径 === 当前路径」对号,换人/清空自动失效
  const modelPath = config?.builtin.modelPath ?? ''
  const fitNote = fitCheck.path === modelPath ? fitCheck.verdict : null
  const ctxInfo = ctxInfoFetched.path === modelPath ? ctxInfoFetched.info : null

  // 上下文档位 + 黑板账单(2026-09-13 产品裁定)
  const {
    contextRaw,
    setContextRaw,
    seedContextRaw,
    contextNotches,
    ctxLine,
    commitContextValue,
    onContextBlur
  } = useContextBill({ config, ctxInfo, commitConfig })

  // 即改即存:防抖聚笔的落盘状态表(在 useConfigAutosave)
  const appearanceRef = useRef(appearance)
  const scaleRef = useRef(scale)

  // AI 配置只读一次存档;之后每一次改动都即改即存(commitConfig)
  useEffect(() => {
    void window.atlas
      .aiConfigGet()
      .then((c) => {
        applyConfig(c)
        // 读档落定上下文框的初始字(打字串和存档数字分开管)
        seedContextRaw(c.contextSize)
      })
      .catch(() => {})
  }, [applyConfig, seedContextRaw])

  // 「AI 设置」直达/侧栏导航点击:入口每点一次 req.seq +1,页内切到指定页(单例签,
  // 签早开着也能再领到这页)
  const lastSectionReq = useRef(0)
  useEffect(() => {
    if (!sectionReq || sectionReq.seq === lastSectionReq.current) return
    lastSectionReq.current = sectionReq.seq
    setPage(sectionReq.section)
    onSettingsSection?.(sectionReq.section)
  }, [sectionReq, onSettingsSection])

  // 版本信息行:CodeAtlas 版本号走 IPC,引擎三件套同步读 process.versions
  useEffect(() => {
    window.atlas
      .appVersion()
      .then(setAppVersion)
      .catch(() => {})
  }, [])

  // 适配估算 + 模型档案:模型路径一变就都问一遍;
  // 结果带着路径入库,显示时按「取数路径 === 当前路径」对号,换人/清空自动失效
  useEffect(() => {
    if (!modelPath.trim()) return
    let alive = true
    void window.atlas
      .modelFitCheck(modelPath)
      .then((v) => {
        if (alive) setFitCheck({ path: modelPath, verdict: v })
      })
      .catch(() => {})
    void window.atlas
      .modelContextInfo(modelPath)
      .then((v) => {
        if (alive) setCtxInfoFetched({ path: modelPath, info: v })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [modelPath])

  // 外观同理:拨一下就 applyAppearance(界面)+ saveAppearance(落盘),没有草稿账
  const updateAppearance = useCallback((patch: Partial<Appearance>): void => {
    const next = { ...appearanceRef.current, ...patch }
    appearanceRef.current = next
    setAppearance(next)
    applyAppearance(next)
    saveAppearance(next)
  }, [])

  // 界面缩放:拖动只挪滑头和 % 读数,界面本身纹丝不动;松手 commitDrag 才
  // setUiScale 一次性应用 + 落盘 + 广播 —— 滑杆拖着界面不重排,眼睛不吃晃
  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  // Ctrl +/-/0 走全局 setUiScale 广播:订阅后滑杆永远跟真值走(即改即存下没有草稿要护)
  useEffect(() => {
    function onUiScale(): void {
      setScale(window.atlas.getUiScale())
      setDragValue(null)
    }
    window.addEventListener(CH.uiScaleChanged, onUiScale)
    return () => window.removeEventListener(CH.uiScaleChanged, onUiScale)
  }, [])

  // 卸载冲线:缩放补一发幂等 setUiScale,防万一中途断在半档上(配置落盘冲线在 useConfigAutosave)
  useEffect(() => {
    return () => {
      window.atlas.setUiScale(scaleRef.current)
    }
  }, [])

  /** 滑条松手落账:预览值 → setUiScale 落盘 + 广播,滑杆读数指回真值 */
  function commitDrag(): void {
    if (dragValue === null) return
    window.atlas.setUiScale(dragValue)
    setScale(dragValue)
    setDragValue(null)
  }

  /** 复位钮:回到 100%,即改即存 */
  function resetScale(): void {
    setDragValue(null)
    window.atlas.setUiScale(1)
    setScale(1)
  }

  function enterCustom(): void {
    // 自定义永远跟着默认档走:不管当前选中哪个预设,种子一律是石墨的灰
    const base = COLOR_PRESETS[0]
    updateAppearance({
      preset: 'custom',
      accent: appearance.accent ?? base.accent,
      secondary: appearance.secondary ?? base.secondary
    })
  }

  async function listModels(): Promise<void> {
    if (!config) return
    const provider = config.provider
    const isCloud = provider === 'cloud'
    setModelsBusy(true)
    setModelsNote(null)
    setModels({ provider, ids: [] })
    try {
      const ids = await window.atlas.aiListModels(
        isCloud
          ? { baseUrl: config.cloud.baseUrl, apiKey: config.cloud.apiKey, provider }
          : { baseUrl: config.lmstudio.baseUrl, apiKey: config.lmstudio.apiKey, provider }
      )
      setModels({ provider, ids })
      if (ids.length === 0) {
        setModelsNote(
          isCloud
            ? '连接成功，但服务商没有返回模型列表，请手动填写模型名。'
            : '服务通了，但没列出模型 —— 先在 LM Studio 里加载一个。'
        )
      }
    } catch (err) {
      setModelsNote(isCloud ? friendlyErr(err) : '连不上这个地址，检查 LM Studio 是否已启动。')
    } finally {
      setModelsBusy(false)
    }
  }

  async function pickModel(): Promise<void> {
    if (!config) return
    const picked = await window.atlas.aiPickFile().catch(() => null)
    if (picked) commitConfig({ ...config, builtin: { ...config.builtin, modelPath: picked } })
  }

  /** 货架下载完主进程已把配置写盘(Provider 切内置 + 模型路径指向新文件);
   *  这儿重读一遍,让界面账对着新现实 */
  function onShelfModelReady(): void {
    void window.atlas.aiConfigGet().then((c) => {
      applyConfig(c)
      onAiConfigSaved?.(c)
    })
  }

  // 自定义色板的兜底永远是默认档,不跟当前预设跑 —— 自定义是「石墨底上自己调色」
  const defaultPreset = COLOR_PRESETS[0]
  const isBuiltin = config?.provider === 'builtin'
  const modelsShown = models.provider === config?.provider ? models.ids : []

  const scaleShown = dragValue ?? scale

  // 说话方式:存档里没有就是全默认 —— 界面照默认摆
  const personal = config?.personalization ?? DEFAULT_PERSONALIZATION
  function updatePersonal(patch: Partial<PersonalizationConfig>): void {
    if (!config) return
    commitConfig({ ...config, personalization: { ...personal, ...patch } })
  }

  return (
    <main className="cfg-page" aria-label="设置">
      <div className="cfg-body">
        {/* 一页一导航:左侧栏选中项即页名,右侧只渲染当前页;换页带微淡入 */}
        <div className="cfg-scroll" key={page}>
          {page === 'appearance' && (
            <SettingsAppearance
              appearance={appearance}
              updateAppearance={updateAppearance}
              enterCustom={enterCustom}
              defaultPreset={defaultPreset}
              scaleShown={scaleShown}
              setDragValue={setDragValue}
              commitDrag={commitDrag}
              resetScale={resetScale}
            />
          )}
          {page === 'ai' && (
            <SettingsAi
              config={config}
              onConfigChange={commitConfig}
              isBuiltin={isBuiltin}
              pickModel={pickModel}
              shelfOpen={shelfOpen}
              setShelfOpen={setShelfOpen}
              onShelfModelReady={onShelfModelReady}
              modelPath={modelPath}
              fitNote={fitNote}
              models={modelsShown}
              modelsBusy={modelsBusy}
              modelsNote={models.provider === config?.provider ? modelsNote : null}
              listModels={listModels}
              contextRaw={contextRaw}
              setContextRaw={setContextRaw}
              onContextBlur={onContextBlur}
              contextNotches={contextNotches}
              commitContextValue={commitContextValue}
              ctxBill={ctxLine}
              personal={personal}
              updatePersonal={updatePersonal}
            />
          )}
          {page === 'net' && <SettingsNet config={config} onConfigChange={commitConfig} />}
          {page === 'about' && <SettingsAbout appVersion={appVersion} />}
        </div>
      </div>
      {/* 落盘失败不装没事:右下角一条红字告警,下一笔写成功自动消 */}
      {saveError && (
        <div className="cfg-save-toast" role="alert">
          设置没存上：{saveError}
        </div>
      )}
    </main>
  )
}
