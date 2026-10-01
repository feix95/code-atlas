import { userDataDir } from './paths.ts'
import { BrowserWindow } from 'electron'
import { parseLmStudioModelState } from '../ai/index.ts'
import { loadAiConfig, resolveAiTarget } from '../ai/config.ts'
import { lastBuiltinStatus } from '../ai/builtin.ts'
import { formatStreamStats } from '../shared/aiText.ts'
import { DEFAULT_LMSTUDIO_BASE_URL, PROBE_LMSTUDIO_MS } from '../shared/aiDefaults.ts'
import { CH } from '../shared/ipcChannels.ts'
import { fetchWithTimeout, stripApiSuffix } from '../ai/http.ts'
import type { AiConfig, AiProviderKind, AiStreamStats, ModelStatus } from '../shared/types.ts'

// ── 第七十锤:模型状态栏的后厨 ──
// 内置引擎的状态由 builtin.ts 播报员推过来;外接 LM Studio 没法订阅,只能低频去问。
// 两路都汇到 broadcastModelStatus,渲染层的常驻底栏只认这一条频道。

export function broadcastModelStatus(status: ModelStatus): void {
  // 第八十八锤:必须挨个窗都发 —— Developer 日志窗进了队,「[0]」不一定是主窗;
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
  if (!model)
    return { ...base, state: 'idle', message: '还没填模型名:去「AI 设置」连一下 LM Studio' }
  try {
    const res = await fetchWithTimeout(`${root}/api/v0/models`, PROBE_LMSTUDIO_MS)
    if (res.ok) {
      const parsed = parseLmStudioModelState(await res.json().catch(() => null), model)
      return { ...base, state: parsed.state, progress: parsed.progress }
    }
    // 老版本 LM Studio 没有 v0 接口:OpenAI 兼容口能列出模型就当就绪
    const legacy = await fetchWithTimeout(`${root}/v1/models`, PROBE_LMSTUDIO_MS)
    return { ...base, state: legacy.ok ? 'ready' : 'unreachable' }
  } catch {
    return {
      ...base,
      state: 'unreachable',
      message: 'LM Studio 没连上:那边开了「开发者」本地服务,这边才看得到'
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
    progress: null
  }
  return resolved.ok
    ? { ...base, state: 'ready' }
    : { ...base, state: 'idle', message: resolved.message }
}

function sameStatus(a: ModelStatus | null, b: ModelStatus): boolean {
  return (
    a !== null &&
    a.provider === b.provider &&
    a.state === b.state &&
    a.modelName === b.modelName &&
    a.message === b.message
  )
}

/** 手动刷一次状态:外接走探测广播;内置的状态归引擎播报员管,这里不越权。
 *  在线 API 状态没变就不广播:否则 10 秒轮询会把干活中的「忙」盖回「就绪」 */
export async function refreshModelStatus(): Promise<void> {
  const config = await loadAiConfig(userDataDir())
  if (config.provider === 'builtin') return
  const status =
    config.provider === 'cloud' ? cloudStatus(config) : await probeLmStudioStatus(config)
  if (config.provider === 'cloud' && sameStatus(lastExternalStatus, status)) return
  lastExternalStatus = status
  broadcastModelStatus(status)
}

// ── 「忙」播报(第八十四锤):就绪 ≠ 闲着 —— 模型请求从发出到收工,状态栏全程在场 ──
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
  const message = stats ? formatStreamStats(stats) : '在干活……'
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
