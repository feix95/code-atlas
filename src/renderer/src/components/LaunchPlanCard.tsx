import { useEffect, useRef, useState } from 'react'
import type { LaunchPlanInfo, MachineProfile } from '@shared/launchPlan'
import {
  launchSignature,
  normalizeModelPathKey,
  type ModelLaunchSettings
} from '@shared/launchSettings'
import { formatGB } from '@shared/contextBill'
import type { AiConfig, ModelStatus } from '@shared/types'
import { CfgRow } from './CfgRow'
import { LaunchAdvancedPanel } from './LaunchAdvancedPanel.tsx'

/** 事实行两段料:领词(名称)+ 规格串 —— 排版层级由样式层定,这里只拆料 */
interface FactParts {
  lead: string
  meta: string
}

/** 机器规格:显卡名 + 显存/空闲/内存规格 */
function machineFact(m: MachineProfile): FactParts {
  const specs: string[] = []
  if (m.gpuName) {
    specs.push(`显存 ${formatGB(m.vramBytes ?? 0)}`)
    if (m.vramFreeBytes != null) specs.push(`空闲 ${formatGB(m.vramFreeBytes)}`)
  }
  specs.push(`内存 ${formatGB(m.ramBytes)}`)
  return { lead: m.gpuName ?? '没认出显卡', meta: specs.join(' · ') }
}

/** 模型登记:模型名 + 体积/MoE/视觉文件规格 */
function modelFact(info: LaunchPlanInfo): FactParts {
  const specs: string[] = []
  if (info.modelBytes != null) specs.push(formatGB(info.modelBytes))
  if (info.isMoe) specs.push('MoE')
  specs.push(info.mmprojFile ? '带视觉文件' : '无视觉文件')
  return { lead: info.modelName ?? '未知模型', meta: specs.join(' · ') }
}

/** 事实行:名称墨色半粗领读,规格灰字小一号跟随 —— 层级纯靠字色字号,不加框线 */
function factLine(parts: FactParts): React.JSX.Element {
  return (
    <p className="lp-line">
      <span className="lp-lead">{parts.lead}</span>
      <span className="lp-meta"> · {parts.meta}</span>
    </p>
  )
}

const VERDICT_LABEL: Record<string, string> = {
  ok: '装得下',
  tight: '有点挤',
  'too-big': '装不下'
}

/** 方案里的空闲显存只在取数那一刻准:卡片摆在屏上、引擎又闲着时,按这个节奏重问一次 */
const PLAN_REFRESH_MS = 10_000

/** 引擎自己占着显存的状态:这期间重算只会把方案误判成装不下,刷新得让路 */
function isEngineRunning(s: ModelStatus): boolean {
  return s.state === 'loading' || s.state === 'ready' || s.state === 'busy'
}

type CardState =
  { status: 'loading' | 'no-model' | 'error' } | { status: 'ready'; info: LaunchPlanInfo }

/** 把草稿账写回配置(空账 = 把这个模型的键删掉,全自动不占存档) */
function withLaunch(config: AiConfig, modelPath: string, s: ModelLaunchSettings): AiConfig {
  const key = normalizeModelPathKey(modelPath)
  const launch = { ...(config.builtin.launch ?? {}) }
  const empty = Object.keys(s.overrides ?? {}).length === 0 && !(s.extraArgs ?? '').trim()
  if (empty) delete launch[key]
  else launch[key] = s
  return { ...config, builtin: { ...config.builtin, launch } }
}

/**
 * 「本机运行方案」:折叠行 —— 行面只留一句说明与结论戳(装得下/有点挤/装不下);
 * 机器规格、模型登记、每条妥协理由收在展开体里。底下「高级设置」是同款折叠行,可逐项手动指定。
 * modelPath/上下文档位/草稿一变就重新问主进程要预览;取数期间照旧显示旧方案不闪 loading。
 * 空闲显存会随别的程序起落,卡片在屏上且引擎闲着时每 10 秒重取一次;引擎自己占着显存时
 * 暂停重取,免得把模型当前占用算成「装不下」。
 */
export function LaunchPlanCard({
  modelPath,
  contextSize,
  config,
  onConfigChange
}: {
  modelPath: string
  contextSize: number | undefined
  config: AiConfig | null
  onConfigChange: (next: AiConfig) => void
}): React.JSX.Element {
  // 高级草稿:按模型路径归户;null = 还没从主进程端回「已存账」,首轮取数后初始化
  const [draft, setDraft] = useState<{ path: string; s: ModelLaunchSettings } | null>(null)
  const draftForPath = draft && draft.path === modelPath ? draft.s : null
  const draftSig = draftForPath ? launchSignature(draftForPath) : '__init'
  const fetchKey = `${modelPath}|${contextSize ?? 0}|${draftSig}`
  // 只存「哪次取数的结果」;loading/no-model 这些态在渲染期现推,不在 effect 里同步 setState
  const [fetched, setFetched] = useState<{
    key: string
    info: LaunchPlanInfo | null
    failed: boolean
  }>({ key: '', info: null, failed: false })
  // 后台重取的序号:一变就再问一次,但不改 fetchKey —— 取数期间照旧摆旧方案,不闪 loading
  const [refreshSeq, setRefreshSeq] = useState(0)
  // 卡片是否真在屏上:设置签保活层用 display:none 藏页,藏住时停掉轮询
  const [onScreen, setOnScreen] = useState(true)
  // 内置引擎正占着显存:这时的空闲读数被模型自己吃了,拿来重算只会误判成「装不下」
  const [engineRunning, setEngineRunning] = useState(false)
  // 方案折叠体:IntersectionObserver 盯着它判断卡片还在不在屏上
  const [cardEl, setCardEl] = useState<HTMLDetailsElement | null>(null)
  // 卡片当前摆着的取数结果:后台刷新失败时靠它判断「已有方案在,不该翻成错误态」
  const fetchedRef = useRef(fetched)
  useEffect(() => {
    fetchedRef.current = fetched
  }, [fetched])

  // 卡片藏在别的页签后面(display:none)时观察器会报不可见 —— 顺着它停轮询
  useEffect(() => {
    if (!cardEl) return
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting))
    io.observe(cardEl)
    return () => io.disconnect()
  }, [cardEl])

  // 引擎状态:先问一次当下账,再跟着广播走,用来决定刷新要不要让路
  useEffect(() => {
    let alive = true
    const apply = (s: ModelStatus): void => {
      if (alive) setEngineRunning(isEngineRunning(s))
    }
    void window.atlas
      .modelStatusGet()
      .then(apply)
      .catch(() => {})
    const off = window.atlas.onModelStatus(apply)
    return () => {
      alive = false
      off()
    }
  }, [])

  const refreshActive = onScreen && !engineRunning && modelPath.trim() !== ''
  // 从「藏住/引擎忙」回到可刷新:先补一发,别等满一个周期;挂载首轮由下面的取数 effect 负责
  const prevRefreshActive = useRef(true)
  useEffect(() => {
    const resumed = refreshActive && !prevRefreshActive.current
    prevRefreshActive.current = refreshActive
    if (!refreshActive) return
    if (resumed) setRefreshSeq((n) => n + 1)
    const tick = (): void => {
      if (document.visibilityState === 'visible') setRefreshSeq((n) => n + 1)
    }
    const timer = window.setInterval(tick, PLAN_REFRESH_MS)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', tick)
    }
  }, [refreshActive])

  useEffect(() => {
    if (!modelPath.trim()) return
    let alive = true
    window.atlas
      .aiLaunchPlan(draftForPath ?? undefined)
      .then((info) => {
        if (!alive) return
        // 首轮把「已存账」端回来当草稿;这份回包本来就是按已存账算的,
        // 直接按新草稿的 key 记账,省一次重复取数
        let key = fetchKey
        if (!draftForPath && info) {
          const init = info.saved ?? {}
          key = `${modelPath}|${contextSize ?? 0}|${launchSignature(init)}`
          setDraft({ path: modelPath, s: init })
        }
        setFetched({ key, info, failed: false })
      })
      .catch(() => {
        if (!alive) return
        // 同一把 key 已有方案在屏上:静默刷新失败就留着旧方案等下一轮,别翻成错误态
        const shown = fetchedRef.current
        if (shown.key === fetchKey && shown.info && !shown.failed) return
        setFetched({ key: fetchKey, info: null, failed: true })
      })
    return () => {
      alive = false
    }
  }, [modelPath, contextSize, fetchKey, draftForPath, refreshSeq])

  const card: CardState = !modelPath.trim()
    ? { status: 'no-model' }
    : fetched.key !== fetchKey
      ? fetched.info && !fetched.failed
        ? { status: 'ready', info: fetched.info } // 预览在途:先摆旧方案,新结果到了再换
        : { status: 'loading' }
      : fetched.failed || !fetched.info
        ? { status: 'error' }
        : { status: 'ready', info: fetched.info }

  const readyInfo = card.status === 'ready' ? card.info : null
  const commitDraft = (s: ModelLaunchSettings): void => {
    setDraft({ path: modelPath, s })
    if (config) onConfigChange(withLaunch(config, modelPath, s))
  }

  // 状态行文案:折叠行的说明位随状态换一句话,行高全场不变
  const stateDesc =
    card.status === 'loading'
      ? '正在测算运行方案……'
      : card.status === 'no-model'
        ? '选择模型文件后，这里会给出运行方案。'
        : card.status === 'error'
          ? '运行方案暂时算不出来，不影响实际启动。'
          : '模型文件读取失败，请确认文件是否存在。'

  return (
    <>
      <div className="cfg-divider" />
      {readyInfo?.plan ? (
        <details className="cfg-fold" ref={setCardEl}>
          <summary className="cfg-fold-summary">
            <div className="cfg-copy">
              <label>本机运行方案</label>
              <p>启动前测算当前模型的运行方案；装不下时自动调低配置。</p>
            </div>
            <span className={`cfg-note lp-verdict is-${readyInfo.plan.estimate.verdict}`}>
              {VERDICT_LABEL[readyInfo.plan.estimate.verdict] ?? '未知'}
            </span>
          </summary>
          <div className="cfg-fold-body">
            {factLine(machineFact(readyInfo.machine))}
            {factLine(modelFact(readyInfo))}
            <ul className="lp-reasons">
              {readyInfo.plan.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            {readyInfo.extraArgs && (
              <p className="cfg-note lp-note">专家参数:{readyInfo.extraArgs.join(' ')}</p>
            )}
          </div>
        </details>
      ) : (
        <CfgRow label="本机运行方案" hint={stateDesc}>
          <span />
        </CfgRow>
      )}
      <div className="cfg-divider" />
      {/* 高级设置:草稿一改立刻重算预览;改了什么随上层防抖写回存档。
          没选模型/还没取回已存账时面板禁态摆着,提示在上面的状态行里 */}
      <LaunchAdvancedPanel
        draft={draftForPath ?? {}}
        hasMmproj={!!readyInfo?.mmprojFile}
        disabled={!config || !modelPath.trim() || !draftForPath}
        onChange={commitDraft}
      />
    </>
  )
}
