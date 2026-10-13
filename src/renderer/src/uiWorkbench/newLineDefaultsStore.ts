// 「新直线默认外观」仓库:直线工具选中、画布无选中时,属性面板编辑的就是它;
// 之后画出的每条直线以此为初始外观。模块单例 + 订阅,只活在内存,关掉软件即回默认
// (与 newRectDefaultsStore 同一做法)。复用 applyLinePatch 做校验,语义与真实直线一致。
import { useSyncExternalStore } from 'react'
import { applyLinePatch, createLine, type LineNode, type LinePatch } from '@shared/uiWorkbench/line'

/** 默认外观的承载节点:端点固定为预览用横线,不进文档 */
const PREVIEW_LENGTH = 100

export type NewLineAppearance = Pick<LineNode, 'stroke' | 'cap'>

let defaults: LineNode = createLine([], { x1: 0, y1: 0, x2: PREVIEW_LENGTH, y2: 0 })
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useNewLineDefaults(): LineNode {
  return useSyncExternalStore(subscribe, () => defaults)
}

export const newLineDefaultsActions = {
  patch(patch: LinePatch): void {
    defaults = applyLinePatch(defaults, patch)
    for (const cb of listeners) cb()
  }
}

/** 取画新直线用的外观 */
export function getNewLineAppearance(): NewLineAppearance {
  return { stroke: { ...defaults.stroke }, cap: defaults.cap }
}
