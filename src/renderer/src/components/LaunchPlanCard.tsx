import { useEffect, useState } from 'react'
import type { LaunchPlanInfo, MachineProfile } from '@shared/launchPlan'
import {
  launchSignature,
  normalizeModelPathKey,
  type ModelLaunchSettings
} from '@shared/launchSettings'
import { formatGB } from '@shared/contextBill'
import type { AiConfig } from '@shared/types'
import { CfgQ, CfgRow } from './CfgRow'
import { LaunchAdvancedPanel } from './LaunchAdvancedPanel.tsx'

/** 机器行:RTX 5060 Ti · 显存 16 GB(空闲 15 GB) · 内存 32 GB */
function machineLine(m: MachineProfile): string {
  const gpu = m.gpuName
    ? `${m.gpuName} · 显存 ${formatGB(m.vramBytes ?? 0)}${m.vramFreeBytes != null ? `(空闲 ${formatGB(m.vramFreeBytes)})` : ''}`
    : '没认出显卡'
  return `${gpu} · 内存 ${formatGB(m.ramBytes)}`
}

/** 模型行:模型名 · 13.4 GB · MoE · 带视觉文件 */
function modelLine(info: LaunchPlanInfo): string {
  const parts: string[] = []
  if (info.modelBytes != null) parts.push(formatGB(info.modelBytes))
  if (info.isMoe) parts.push('MoE')
  parts.push(info.mmprojFile ? '带视觉文件' : '无视觉文件')
  return `${info.modelName ?? '未知模型'} · ${parts.join(' · ')}`
}

const VERDICT_LABEL: Record<string, string> = {
  ok: '装得下',
  tight: '有点挤',
  'too-big': '装不下'
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
 * 「本机运行方案」卡(智能启动锤):把启动方案摊给用户看 —— 机器家底、
 * 模型户口、装得下结论、每条妥协理由;底下「高级设置」面板可逐项手动指定。
 * modelPath/上下文档位/草稿一变就重新问主进程要预览;取数期间照旧显示旧方案不闪 loading。
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
        if (alive) setFetched({ key: fetchKey, info: null, failed: true })
      })
    return () => {
      alive = false
    }
  }, [modelPath, contextSize, fetchKey, draftForPath])

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

  return (
    <CfgRow
      label={
        <>
          本机运行方案
          <CfgQ tip="启动前把这台机器的家底和模型户口过一遍算盘:显卡摆层交给引擎自动安排,装不下时会写明怎么省。" />
        </>
      }
      stacked
    >
      <div className="lp-card">
        {card.status === 'loading' && <p className="cfg-note lp-note">正在量机器家底……</p>}
        {card.status === 'no-model' && (
          <p className="cfg-note lp-note">先在上面选好模型文件,这里会算出它在这台机器上怎么跑。</p>
        )}
        {card.status === 'error' && (
          <p className="cfg-note lp-note">
            方案算不出来,不影响实际启动;真跑的时候引擎会自己再算一次。
          </p>
        )}
        {readyInfo && (
          <>
            <p className="lp-line">{machineLine(readyInfo.machine)}</p>
            <p className="lp-line">{modelLine(readyInfo)}</p>
            {readyInfo.plan ? (
              <>
                <p className={`cfg-note lp-verdict is-${readyInfo.plan.estimate.verdict}`}>
                  {VERDICT_LABEL[readyInfo.plan.estimate.verdict] ?? '未知'}
                </p>
                <ul className="lp-reasons">
                  {readyInfo.plan.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                {readyInfo.extraArgs && (
                  <p className="cfg-note lp-note">专家参数:{readyInfo.extraArgs.join(' ')}</p>
                )}
              </>
            ) : (
              <p className="cfg-note lp-note">模型文件读不到,方案出不来;请检查文件还在不在。</p>
            )}
          </>
        )}
        {/* 高级设置:草稿一改立刻重算预览;改了什么随上层防抖写回存档。
            没选模型/还没取回已存账时面板禁态摆着,提示在上面的状态行里 */}
        <LaunchAdvancedPanel
          draft={draftForPath ?? {}}
          autoParams={readyInfo?.autoParams ?? null}
          hasMmproj={!!readyInfo?.mmprojFile}
          disabled={!config || !modelPath.trim() || !draftForPath}
          onChange={commitDraft}
        />
      </div>
    </CfgRow>
  )
}
