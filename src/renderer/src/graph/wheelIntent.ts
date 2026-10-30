// 滚轮手势的意图判定:空白处滚轮 = 缩放;在节点上停稳后滚轮 = 切换悬停看法;按住 Ctrl 滚轮 = 进出层级
// (触控板双指捏合也以 Ctrl+滚轮的形式到达)。一串连续的滚轮事件算一个手势,整个手势保持开头判定的动作,
// 滚着滚着划过节点也不会从缩放变成切看法。纯函数,不依赖 DOM。
import { GRAPH_WHEEL } from './graphConfig.ts'

export type WheelAction = 'zoom' | 'mode' | 'level'

export interface WheelGesture {
  action: WheelAction
  /** 手势开始的时间(ms);等于本次事件时间 = 这是新手势 */
  startedAt: number
  /** 上一个滚轮事件的时间(ms) */
  lastAt: number
  /** 累计但还没换成「一步」的滚动量(像素) */
  acc: number
  /** 层级手势已经走过一步:同一手势里不再走 */
  done: boolean
}

/** 统一换算成像素:按行滚动(deltaMode 1)约 16px 一行,按页(2)约 800px 一页 */
export function wheelDeltaPx(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 16
  if (deltaMode === 2) return deltaY * 800
  return deltaY
}

/**
 * 接着上一个手势,还是开始新手势。新手势的动作:按着 Ctrl = 层级;鼠标在某节点上已停够 restMs = 切看法;
 * 其余 = 缩放。hoverSince 是鼠标开始停在当前节点上的时间,null = 没停在节点上。
 */
export function nextGesture(
  prev: WheelGesture | null,
  now: number,
  ctrl: boolean,
  hoverSince: number | null
): WheelGesture {
  if (prev && now - prev.lastAt < GRAPH_WHEEL.gestureGapMs) return { ...prev, lastAt: now }
  const rested = hoverSince !== null && now - hoverSince >= GRAPH_WHEEL.restMs
  const action: WheelAction = ctrl ? 'level' : rested ? 'mode' : 'zoom'
  return { action, startedAt: now, lastAt: now, acc: 0, done: false }
}

/**
 * 把这次的滚动量累进手势,换算成要走的步数(正 = 往下滚)。
 * 切看法:每满 modeStepPx 走一步;层级:累计满 levelStepPx 走一步,同一手势只走一次;缩放:不走步。
 */
export function takeSteps(
  g: WheelGesture,
  deltaPx: number
): { gesture: WheelGesture; steps: number } {
  if (g.action === 'zoom') return { gesture: g, steps: 0 }
  if (g.action === 'level') {
    if (g.done) return { gesture: g, steps: 0 }
    const acc = g.acc + deltaPx
    if (Math.abs(acc) < GRAPH_WHEEL.levelStepPx) return { gesture: { ...g, acc }, steps: 0 }
    return { gesture: { ...g, acc: 0, done: true }, steps: Math.sign(acc) }
  }
  const acc = g.acc + deltaPx
  const steps = Math.trunc(acc / GRAPH_WHEEL.modeStepPx)
  return { gesture: { ...g, acc: acc - steps * GRAPH_WHEEL.modeStepPx }, steps }
}
