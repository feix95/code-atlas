import { userDataDir } from './paths.ts'
import { BrowserWindow } from 'electron'
import { parseLmStudioModelState } from '../ai/index.ts'
import { loadAiConfig, resolveAiTarget } from '../ai/config.ts'
import { builtinIdleStatus, builtinVisionSupport, lastBuiltinStatus } from '../ai/builtin.ts'
import { formatStreamStats } from '../shared/aiText.ts'
import { DEFAULT_LMSTUDIO_BASE_URL, PROBE_LMSTUDIO_MS } from '../shared/aiDefaults.ts'
import { CH } from '../shared/ipcChannels.ts'
import { fetchWithTimeout, stripApiSuffix } from '../ai/http.ts'
import { parseLmStudioModelVision } from '../ai/visionProbe.ts'
import { cloudVisionOf } from '../shared/visionModels.ts'
import { sameModelStatus } from '../shared/statusCompare.ts'
import type {
  AiConfig,
  AiProviderKind,
  AiStreamStats,
  ModelStatus,
  VisionSupport
} from '../shared/types.ts'

// 模型状态栏的后厨
// 内置引擎的状态由 builtin.ts 播报员推过来;外接 LM Studio 没法订阅,只能低频去问。
// 两路都汇到 broadcastModelStatus,渲染层的常驻底栏只认这一条频道。

/** 最后一次真播出去的状态(轮询/引擎播报员/忙闲播报共用这一个口):
    「卡上现在显示什么」的唯一真相 —— 刷新去重要认它,不能只认上次算过的外接账 */
let lastBroadcast: ModelStatus | null = null

export function broadcastModelStatus(status: ModelStatus): void {
  lastBroadcast = status
  // 必须挨个窗都发 —— Developer 日志窗进了队,「[0]」不一定是主窗;
  // 广播喂给没人听的日志窗,主窗底栏就冻死在「还没叫醒」
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CH.modelStatus, status)
  }
}

/** 问一轮 LM Studio:模型加载了没/热身到多少;服务没开就老实说没连上,不装没事 */
export async function probeLmStudioStatus(config: AiConfig): Promise<ModelStatus> {
  const model = config.lmstudio.model.trim()
  const root = stripApiSuffix(config.lmstudio.baseUrl.trim() || DEFAULT_LMSTUDIO_BASE_URL)
  const base = { provider: 'lmstudio' as const, modelName: model, sizeBytes: null, progress: null }
  if (!model) return { ...base, state: 'idle', message: '未填写模型名，在 AI 设置中配置 LM Studio' }
  try {
    const res = await fetchWithTimeout(`${root}/api/v0/models`, PROBE_LMSTUDIO_MS)
    if (res.ok) {
      const json = await res.json().catch(() => null)
      const parsed = parseLmStudioModelState(json, model)
      // 条目 type 捎带能力账:vlm 能看图,llm 纯文本,认不出 unknown
      return {
        ...base,
        state: parsed.state,
        progress: parsed.progress,
        vision: parseLmStudioModelVision(json, model)
      }
    }
    // 老版本 LM Studio 没有 v0 接口:OpenAI 兼容口能列出模型就当就绪
    const legacy = await fetchWithTimeout(`${root}/v1/models`, PROBE_LMSTUDIO_MS)
    return { ...base, state: legacy.ok ? 'ready' : 'unreachable' }
  } catch {
    return {
      ...base,
      state: 'unreachable',
      message: '无法连接 LM Studio，开启开发者服务'
    }
  }
}

/** 在线 API 的状态:不发网络请求(按次计费的服务不做轮询),配置齐全即「就绪」,缺项说清缺什么 */
export function cloudStatus(config: AiConfig): ModelStatus {
  const resolved = resolveAiTarget(config)
  const base = {
    provider: 'cloud' as const,
    modelName: config.cloud.model.trim(),
    sizeBytes: null,
    progress: null,
    // 在线 API 没有查询口,按模型名认账(命中已知视觉系才报 vision,其余 unknown)
    vision: cloudVisionOf(config.cloud.model)
  }
  return resolved.ok
    ? { ...base, state: 'ready' }
    : { ...base, state: 'idle', message: resolved.message }
}

/**
 * 带图请求前的能力闸账:内置按 mmproj 登记(跑着且报过 vision 的优先),
 * 在线 API 按模型名认账,LM Studio 当场探一轮条目 type。与状态卡的显示口径同源。
 */
export async function probeChatVision(config: AiConfig): Promise<VisionSupport> {
  if (config.provider === 'builtin') return builtinVisionSupport(config.builtin.modelPath)
  if (config.provider === 'cloud') return cloudVisionOf(config.cloud.model)
  return (await probeLmStudioStatus(config)).vision ?? 'unknown'
}

/** 手动刷一次状态(存档/轮询/开窗都走这):照当前配置的 provider 立刻报话。
 *  内置拿引擎播报员手里最新的账,没账按配置兜底(同 modelStatusGet 口径)——
 *  换了 provider 要当场换脸,不能空等引擎下一句。
 *  两道闸:卡上正在播的已经就是这份 = 没变不打扰;
 *  同家还在「忙」(请求在飞):算出来的闲态别抢话,忙播报员自己会收尾 */
export async function refreshModelStatus(): Promise<void> {
  const config = await loadAiConfig(userDataDir())
  const status =
    config.provider === 'builtin'
      ? (lastBuiltinStatus() ?? builtinIdleStatus(config.builtin.modelPath))
      : config.provider === 'cloud'
        ? cloudStatus(config)
        : await probeLmStudioStatus(config)
  if (sameModelStatus(lastBroadcast, status)) return
  if (lastBroadcast?.provider === status.provider && lastBroadcast.state === 'busy') return
  if (status.provider !== 'builtin') lastExternalStatus = status
  broadcastModelStatus(status)
}

// 「忙」播报:就绪 ≠ 闲着 —— 模型请求从发出到收工,状态栏全程在场
// 起点在 resolveChatTargetOrError(每个模型请求的必经口),终点在 explainWithCancel /
// 自由对话的 finally(explainAborters 清空才收工,嵌套的讲解不会中途闪「就绪」)。
let lastExternalStatus: ModelStatus | null = null
export let lastActivityProvider: AiProviderKind = 'builtin'

/** 当前该拿谁的身份说「忙」:内置用播报员手里的真身,外接(LM Studio/在线 API)用最近一轮状态 */
export function announceActivityBusy(provider: AiProviderKind, stats?: AiStreamStats): void {
  lastActivityProvider = provider
  const base = provider === 'builtin' ? lastBuiltinStatus() : lastExternalStatus
  if (!base) return
  // 引擎还在热身时,加载播报员 owns 这个频道,「忙」不许抢话
  if (base.state === 'loading' || base.state === 'idle') return
  const message = stats ? formatStreamStats(stats) : '处理中'
  broadcastModelStatus({ ...base, state: 'busy', progress: null, estimated: undefined, message })
}

/** 一轮活干完(或干砸了):回到「就绪」,别让「忙」挂在那里变成谎话 */
export function announceActivityIdle(): void {
  const provider = lastActivityProvider
  const base = provider === 'builtin' ? lastBuiltinStatus() : lastExternalStatus
  if (!base) return
  if (base.state !== 'loading' && base.state !== 'idle') {
    broadcastModelStatus({ ...base, state: 'ready', progress: null, estimated: undefined })
  }
}

/** 外头的账房要记「最近在使唤谁家模型」:写口只此一处,读走 live binding */
export function setActivityProvider(provider: AiProviderKind): void {
  lastActivityProvider = provider
}
