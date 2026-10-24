// 内置模型的状态播报:引擎在干嘛由这里记账并喊给状态栏。
// progress 只在 /health 真报了数时给值,拿不到就 null,绝不编百分比。
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import type { ModelStatus, VisionSupport } from '../shared/types.ts'
import { findMmprojFor } from './mmproj.ts'

/** 状态栏播报员:main 进程注册,状态一动就往窗口广播 */
let statusAnnouncer: ((status: ModelStatus) => void) | null = null
/** 最近一次播报(状态栏查询时的兜底) */
let lastStatus: ModelStatus | null = null

export function setBuiltinStatusAnnouncer(announce: ((status: ModelStatus) => void) | null): void {
  statusAnnouncer = announce
}

/** 最近一次内置模型状态(没播报过就是 null,由调用方拿配置兜底) */
export function lastBuiltinStatus(): ModelStatus | null {
  return lastStatus
}

export function builtinStatus(
  state: ModelStatus['state'],
  modelName: string,
  sizeBytes: number | null,
  progress: number | null = null,
  message?: string,
  estimated = false,
  vision?: VisionSupport
): ModelStatus {
  return {
    provider: 'builtin',
    state,
    modelName,
    sizeBytes,
    progress,
    ...(estimated ? { estimated: true } : {}),
    ...(message ? { message } : {}),
    ...(vision !== undefined && vision !== 'unknown' ? { vision } : {})
  }
}

export function announceBuiltin(status: ModelStatus): void {
  lastStatus = status
  try {
    statusAnnouncer?.(status)
  } catch {
    // 播报员打喷嚏不影响引擎干活
  }
}

/** 没开引擎时的展示信息:上次用的模型名 + 文件多大;文件失踪就老实说,不报假数 */
export function builtinIdleFacts(modelPath: string): {
  modelName: string
  sizeBytes: number | null
  message?: string
} {
  const p = modelPath.trim()
  if (!p)
    return {
      modelName: '',
      sizeBytes: null,
      message: '还没选模型:去「AI 设置」挑一个 GGUF 模型文件'
    }
  try {
    return { modelName: basename(p), sizeBytes: statSync(p).size }
  } catch {
    return {
      modelName: basename(p),
      sizeBytes: null,
      message: '模型文件找不到了(可能被挪走或删了):去「AI 设置」重新选一下'
    }
  }
}

export function announceBuiltinError(modelPath: string, err: unknown): void {
  const facts = builtinIdleFacts(modelPath)
  announceBuiltin(
    builtinStatus(
      'error',
      facts.modelName,
      facts.sizeBytes,
      null,
      err instanceof Error ? err.message : String(err)
    )
  )
}

/** 内置模型当前能不能看图():
 *  跑着/就绪的引擎自己报过账最可信(/props 探测的实话);没起或还在加载时,
 *  按模型旁的 mmproj 登记判意图 —— 有投影仪就是奔着视觉去的,文件在但引擎还没带上它
 *  会由 builtinNeedsRestart 重启补齐;没模型文件可判时老实说 unknown */
export function builtinVisionSupport(modelPath: string): VisionSupport {
  const live = lastStatus
  if (live && (live.state === 'ready' || live.state === 'busy') && live.vision === 'vision')
    return 'vision'
  if (modelPath.trim() === '') return 'unknown'
  return findMmprojFor(modelPath) !== null ? 'vision' : 'text-only'
}

/** 内置模型的「还没叫醒」状态(状态栏查询与配置保存后复位用) */
export function builtinIdleStatus(modelPath: string): ModelStatus {
  const facts = builtinIdleFacts(modelPath)
  // 引擎没起时按 mmproj 登记认能力:有投影仪→视觉,没有→纯文本(拿不准的留 unknown)
  const vision =
    modelPath.trim() === '' ? 'unknown' : findMmprojFor(modelPath) !== null ? 'vision' : 'text-only'
  return builtinStatus('idle', facts.modelName, facts.sizeBytes, null, facts.message, false, vision)
}
