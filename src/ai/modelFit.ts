// 提前适配估算:选模型那一刻就拿「模型块头」比「机器尺寸」,带不动当场说,
// 不让用户白等一场。启动就死的退出诊断也靠这里的估账说人话。
import { DEFAULT_CONTEXT_SIZE } from '../shared/aiDefaults.ts'
import { estimateKvBytes, formatGB } from '../shared/contextBill.ts'
import {
  MODEL_FIT_RAM_MAX_RATIO,
  MODEL_FIT_RAM_OK_RATIO,
  MODEL_FIT_VRAM_RATIO
} from '../shared/modelShelf.ts'

const GB = 1024 ** 3

export interface ModelFitVerdictPure {
  level: 'ok' | 'tight' | 'too-big'
  title: string
  detail: string
  /** too-big 时给的建议上限(GB);只在这种档位出现 */
  suggestGB?: number
}

// GGUF 档案读取搬进了 modelShape.ts(ipcModel / launchPlanner / 本文件三处共用),re-export 保住老登记
export { readModelShape } from './modelShape.ts'

/**
 * 适配估算公式(纯函数,自测覆盖):模型块头 vs 显存+内存。
 * 有显存:≤90% 显存 = 全进卡(最快);再往上挤到「显存+一半内存」= 能跑但落内存会慢;
 * 超过 = 必然靠硬盘硬扛,直接劝退。没问到显存:只看内存,权重超过内存七成就算挤。
 */
export function judgeModelFit(
  modelBytes: number,
  ramBytes: number,
  vramBytes: number | null,
  contextTokens = DEFAULT_CONTEXT_SIZE
): ModelFitVerdictPure {
  if (vramBytes !== null && vramBytes > 0) {
    // 显存是权重 + 上下文缓存一起抢的,适配估算把缓存估进去再说话
    const kv = estimateKvBytes(contextTokens, modelBytes)
    const need = modelBytes + kv
    if (need <= vramBytes * MODEL_FIT_VRAM_RATIO) {
      return {
        level: 'ok',
        title: '可以运行',
        detail: `模型 ${formatGB(modelBytes)}，上下文缓存按 ${Math.round(contextTokens)} tokens 估算约 ${formatGB(kv)}，共需 ${formatGB(need)}，显存 ${formatGB(vramBytes)}，可以整体进显卡`
      }
    }
    if (need <= vramBytes + ramBytes * MODEL_FIT_RAM_OK_RATIO) {
      return {
        level: 'tight',
        title: '接近内存上限',
        detail: `模型 ${formatGB(modelBytes)}，上下文缓存按 ${Math.round(contextTokens)} tokens 估算约 ${formatGB(kv)}，超出显存 ${formatGB(vramBytes)}，多余部分使用内存，运行会偏慢`
      }
    }
    const suggest = Math.floor(Math.max(1, vramBytes * MODEL_FIT_VRAM_RATIO - kv) / GB)
    return {
      level: 'too-big',
      title: '超出本机内存',
      suggestGB: suggest,
      detail: `模型 ${formatGB(modelBytes)}，显存 ${formatGB(vramBytes)} 和内存合计不足，建议换 ${suggest} GB 以下的模型`
    }
  }
  // 纯内存跑(问不到显存,A/老卡):适配估算只答装不装得下,缓存不另估 —— 内存机型本身就慢,
  // 缓存那点开销改变不了结论,别拿估出来的数字吓人
  if (modelBytes <= ramBytes * MODEL_FIT_RAM_OK_RATIO) {
    return {
      level: 'ok',
      title: '可以运行',
      detail: `模型 ${formatGB(modelBytes)}，内存 ${formatGB(ramBytes)}，可以运行`
    }
  }
  if (modelBytes <= ramBytes * MODEL_FIT_RAM_MAX_RATIO) {
    return {
      level: 'tight',
      title: '接近内存上限',
      detail: `模型 ${formatGB(modelBytes)}，内存 ${formatGB(ramBytes)}，可以运行但系统会偏慢`
    }
  }
  const suggest = Math.floor((ramBytes * MODEL_FIT_RAM_OK_RATIO) / GB)
  return {
    level: 'too-big',
    title: '超出本机内存',
    suggestGB: suggest,
    detail: `模型 ${formatGB(modelBytes)}，内存 ${formatGB(ramBytes)}，建议换 ${suggest} GB 以下的模型`
  }
}

/**
 * 引擎「启动就死」的退出诊断报告(纯函数,自测覆盖):分清内存耗尽退出、上下文填爆、还是文件坏了,
 * 不再一句「可能太大」糊弄所有人。内存耗尽退出要拿适配估算的数字说话;上下文嫌疑只在手动填大了时点。
 */
export function autopsyExitMessage(
  exitCode: number | null,
  fit: ModelFitVerdictPure,
  manualContext: number | null
): string {
  if (fit.level === 'too-big') {
    const hint =
      fit.suggestGB !== undefined ? `建议换 ${fit.suggestGB} GB 以下的模型` : '请换更小的模型'
    return `模型超出本机内存，退出码 ${exitCode ?? '未知'}，${hint}`
  }
  if (manualContext !== null && manualContext >= 32768) {
    return `内置模型启动失败，退出码 ${exitCode ?? '未知'}，清空模型上下文或重新下载模型`
  }
  return `内置模型启动失败，退出码 ${exitCode ?? '未知'}，请重新选择模型文件`
}
