// 热身估价小状态表(第七十一批起,第七十五批改滚动三条):
// 这版引擎(build 10786)加载期间 /health 不带进度、日志不打印,真百分比三头都拿不到。
// 但同一台电脑同一个模型,热身耗时相当稳 —— 记下成功热身的耗时,下次按「已用时÷均值」
// 画一条有据的估,封顶 95%(没真就绪绝不报 100),标「约」字;头一回没账就转圈。
// 只记确认加载成功的那次(取消/半路死掉的不入账);每模型滚动留最近 3 次 —— 开机第一次
// 冷读慢、之后热读快,均值把运气摊薄,坏运气只占三分之一话语权,换盘挪模型三轮就淡出去。
// 状态表存 userData/model-warmup.json,这是应用自己的小状态表,不碰项目文件。
import { readJsonFile, writeJsonFile } from '../shared/jsonFile.ts'
import { builtinDataFile } from './builtinDataDir.ts'

/** 同一数据源最多记最近几次成功热身 */
const WARMUP_SAMPLES = 3

/** 状态表原始内容 → 某模型的最近热身样本(纯函数,自测覆盖)。
 * 老格式(单个数)自动当一次历史;脏账(<1 秒/非数)剔除;只认最近 3 条;全脏回 null */
export function parseWarmupSamples(raw: unknown, modelPath: string): number[] | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = (raw as Record<string, unknown>)[modelPath]
  const list = typeof entry === 'number' ? [entry] : Array.isArray(entry) ? entry : []
  const samples = list
    .filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms >= 1000)
    .slice(-WARMUP_SAMPLES)
    .map((ms) => Math.round(ms))
  return samples.length > 0 ? samples : null
}

/** 样本均值(纯函数,自测覆盖):没有样本回 null,别硬估 */
export function averageWarmup(samples: number[]): number | null {
  if (samples.length === 0) return null
  return Math.round(samples.reduce((sum, ms) => sum + ms, 0) / samples.length)
}

/** 状态表更新:某模型刚热身完,入一笔,只留最近 3 次(纯函数,自测覆盖;垃圾输入就地开新账) */
export function nextWarmupStore(
  raw: unknown,
  modelPath: string,
  ms: number
): Record<string, number[]> {
  const base: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
  const old = parseWarmupSamples(base, modelPath) ?? []
  base[modelPath] = [...old, Math.max(1000, Math.round(ms))].slice(-WARMUP_SAMPLES)
  return base as Record<string, number[]>
}

function warmupFilePath(): string | null {
  return builtinDataFile('model-warmup.json')
}

/** 某模型的估价基准 = 最近样本的均值;没账/坏账回 null */
export function readWarmupMs(modelPath: string): number | null {
  const file = warmupFilePath()
  if (!file) return null
  const samples = parseWarmupSamples(readJsonFile(file), modelPath)
  return averageWarmup(samples ?? [])
}

export function recordWarmupMs(modelPath: string, ms: number): void {
  const file = warmupFilePath()
  if (!file) return
  const raw = readJsonFile(file) ?? {}
  writeJsonFile(file, nextWarmupStore(raw, modelPath, ms))
}
