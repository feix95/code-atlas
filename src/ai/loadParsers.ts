// 启动期的纯算盘:热身提醒与估价、/health 进度解析、GPU 层数报告、显存不够记号。
// 全是纯函数(自测直接喂),不碰进程也不碰文件。

/** 热身多久没好开始温柔提醒(产品裁定):绝不掐进程 —— 大模型从机械盘
 * 搬进显存两三分钟是常事,掐表只会杀死健康的加载;等不等由用户手里的「取消」说了算 */
const WARMUP_NUDGE_MS = 5 * 60_000

/**
 * 热身太久的温柔提醒(纯函数,自测覆盖):5 分钟还没好才开口,一句话管理预期,
 * 绝不吓唬也绝不催命 —— 去留是用户手里「取消」的事,不是闹钟的事。
 */
export function warmupNudgeMessage(elapsedMs: number): string | undefined {
  return elapsedMs >= WARMUP_NUDGE_MS
    ? '这次热身有点久:大模型第一次要从硬盘整个搬一遍,慢是正常的;不想等就点「取消」,搬完它自己会说'
    : undefined
}

/** 热身估价公式:已用时 ÷ 最近样本均值 → 百分比,1~95 封顶(纯函数,自测覆盖)。
 * 没账可查回 null(界面转圈);宁慢勿快 —— 封顶 95,没真就绪绝不谎报到手。
 */
export function estimateLoadProgress(elapsedMs: number, lastMs: number | null): number | null {
  if (lastMs === null || !Number.isFinite(lastMs) || lastMs <= 0) return null
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1
  return Math.max(1, Math.min(95, Math.floor((elapsedMs / lastMs) * 100)))
}

/**
 * 从 /health 的 503 响应体里抠加载进度。llama.cpp 新版给
 * {"error":{"message":"Loading model","progress":0.42}},老版啥都不给。
 * 0~1 当比例 ×100,1~100 当百分数,出了范围或不是数 = 拿不到(纯函数,自测覆盖)。
 */
export function parseLoadProgress(body: unknown): number | null {
  const raw =
    typeof body === 'number'
      ? body
      : body !== null && typeof body === 'object'
        ? ((body as { progress?: unknown }).progress ??
          (body as { error?: { progress?: unknown } }).error?.progress)
        : undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  if (raw <= 1) return raw * 100
  if (raw <= 100) return raw
  return null
}

export interface GpuOffloadReport {
  offloaded: number
  total: number
}

export function parseGpuOffloadReport(line: string): GpuOffloadReport | null {
  const hit = line.match(/offloaded\s+(\d+)\s*\/\s*(\d+)\s+layers?\s+to\s+GPU/i)
  if (!hit) return null
  const offloaded = Number(hit[1])
  const total = Number(hit[2])
  if (
    !Number.isInteger(offloaded) ||
    !Number.isInteger(total) ||
    total <= 0 ||
    offloaded < 0 ||
    offloaded > total
  )
    return null
  return { offloaded, total }
}

export function gpuOffloadWarning(report: GpuOffloadReport | null): string | undefined {
  if (report === null || report.offloaded >= report.total) return undefined
  return `模型只有 ${report.offloaded}/${report.total} 层放进显卡,其余要在内存里跑,吐字会明显变慢。关掉占显存的程序后点「卸下」再重载,或把「模型上下文」调小。`
}

/** 引擎日志里的显存不够记号(纯函数,自测覆盖):保险丝据此换「显存不够」那句人话 */
export function engineLogHasOom(line: string): boolean {
  return /ErrorOutOfDeviceMemory|out of memory|cudaMalloc failed|failed to allocate/i.test(line)
}
