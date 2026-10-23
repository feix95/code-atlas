// 提前适配估算(第七十三批):选模型那一刻就拿「模型块头」比「机器尺寸」,带不动当场说,
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
    // 第八十六批:显存是权重 + 上下文缓存一起抢的,适配估算把缓存估进去再说话
    const kv = estimateKvBytes(contextTokens, modelBytes)
    const need = modelBytes + kv
    if (need <= vramBytes * MODEL_FIT_VRAM_RATIO) {
      return {
        level: 'ok',
        title: '装得下',
        detail: `模型 ${formatGB(modelBytes)} + 上下文缓存估 ${formatGB(kv)}(按 ${Math.round(contextTokens)} tokens)≈ ${formatGB(need)},显存 ${formatGB(vramBytes)} —— 整个进显卡,跑得动`
      }
    }
    if (need <= vramBytes + ramBytes * MODEL_FIT_RAM_OK_RATIO) {
      return {
        level: 'tight',
        title: '有点挤',
        detail: `模型 ${formatGB(modelBytes)} + 上下文缓存估 ${formatGB(kv)}(按 ${Math.round(contextTokens)} tokens)超出了显存 ${formatGB(vramBytes)},多出来的要落内存 —— 能跑,但读大材料时会明显变慢;把「模型上下文」调小能快回来`
      }
    }
    const suggest = Math.floor(Math.max(1, vramBytes * MODEL_FIT_VRAM_RATIO - kv) / GB)
    return {
      level: 'too-big',
      title: '这台机器装不下',
      detail: `模型 ${formatGB(modelBytes)},加上上下文缓存连显存 ${formatGB(vramBytes)} 带内存一起匀也紧张 —— 建议换 ${suggest} GB 以下的模型,或加内存条`
    }
  }
  // 纯内存跑(问不到显存,A/老卡):适配估算只答装不装得下,缓存不另估 —— 内存机型本身就慢,
  // 缓存那点开销改变不了结论,别拿估出来的数字吓人
  if (modelBytes <= ramBytes * MODEL_FIT_RAM_OK_RATIO) {
    return {
      level: 'ok',
      title: '装得下',
      detail: `模型 ${formatGB(modelBytes)},内存 ${formatGB(ramBytes)} —— 装得下`
    }
  }
  if (modelBytes <= ramBytes * MODEL_FIT_RAM_MAX_RATIO) {
    return {
      level: 'tight',
      title: '有点挤',
      detail: `模型 ${formatGB(modelBytes)},内存 ${formatGB(ramBytes)} —— 塞得下但系统会挤,跑起来偏慢`
    }
  }
  const suggest = Math.floor((ramBytes * MODEL_FIT_RAM_OK_RATIO) / GB)
  return {
    level: 'too-big',
    title: '这台机器装不下',
    detail: `模型 ${formatGB(modelBytes)},内存只有 ${formatGB(ramBytes)} —— 建议换 ${suggest} GB 以下的模型`
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
    return `模型在这台机器上装不下,引擎一启动就内存耗尽退出了(退出码 ${exitCode ?? '未知'})。${fit.detail}`
  }
  if (manualContext !== null && manualContext >= 32768) {
    return `内置模型启动就退出了(退出码 ${exitCode ?? '未知'})。最常见的两个原因:①设置里「模型上下文」填得太大(当前 ${manualContext})—— 清空它,回到自动探测;②模型文件损坏 —— 重新下一个`
  }
  return `内置模型启动就退出了(退出码 ${exitCode ?? '未知'}):常见原因是模型文件损坏或被别的程序占用,重新选一个模型文件试试`
}
