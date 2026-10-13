// 「新矩形默认外观」仓库:矩形工具选中、画布无选中时,属性面板编辑的就是它;
// 之后画出的每个矩形以此为初始外观。模块单例 + 订阅,只活在内存,关掉软件即回默认。
// 复用 applyRectPatch 做校验(取整、钳边界、改外观静默脱钩样式),语义与真实节点一致。
import { useSyncExternalStore } from 'react'
import { applyRectPatch, createRect, type RectNode, type RectPatch } from '@shared/uiWorkbench/node'
import { getStyles } from './styleStore'

/** 默认外观的承载节点:几何固定为预览用方块(圆角上限 = 短边一半),不进文档 */
const PREVIEW_SIDE = 100

export type NewRectAppearance = Pick<RectNode, 'fill' | 'stroke' | 'radii' | 'styleId'>

let defaults: RectNode = createRect([], { x: 0, y: 0, width: PREVIEW_SIDE, height: PREVIEW_SIDE })
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useNewRectDefaults(): RectNode {
  return useSyncExternalStore(subscribe, () => defaults)
}

export const newRectDefaultsActions = {
  patch(patch: RectPatch): void {
    defaults = applyRectPatch(defaults, patch)
    for (const cb of listeners) cb()
  }
}

/** 取画新矩形用的外观;styleId 指向已删除的样式时按「无样式」落位 */
export function getNewRectAppearance(): NewRectAppearance {
  const { fill, stroke, radii, styleId } = defaults
  return {
    fill,
    stroke,
    radii,
    styleId: getStyles().some((s) => s.id === styleId) ? styleId : null
  }
}
