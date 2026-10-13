// 「新矩形默认外观」仓库:矩形工具选中、画布无选中时,属性面板编辑的就是它;
// 之后画出的每个矩形以此为初始外观。模块单例 + 订阅。
// 默认外观本身只活在内存(重启回浅灰),唯一持久的是「最近使用的已保存样式 id」:
// 应用/保存过某个样式后,下次画新矩形沿用它(跨重启),直到换样式或选「无样式」(回内置默认)。
// 复用 applyRectPatch 做校验(取整、钳边界、改外观静默脱钩样式),语义与真实节点一致。
import { useSyncExternalStore } from 'react'
import { applyRectPatch, createRect, type RectNode, type RectPatch } from '@shared/uiWorkbench/node'
import { resolveLinkedLook, type StyleAppearance } from '@shared/uiWorkbench/styles'
import { getStyles } from './styleStore'

/** 默认外观的承载节点:几何固定为预览用方块(圆角上限 = 短边一半),不进文档 */
const PREVIEW_SIDE = 100
const STORAGE_KEY = 'atlas.uiWorkbench.newRectStyleId'

export type NewRectAppearance = Pick<RectNode, 'fill' | 'stroke' | 'radii' | 'styleId'>

function builtinDefaults(): RectNode {
  return createRect([], { x: 0, y: 0, width: PREVIEW_SIDE, height: PREVIEW_SIDE })
}

function readStoredStyleId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch (err) {
    console.warn('[uiWorkbench] 新矩形默认样式读取失败,回落内置默认', { key: STORAGE_KEY, err })
    return null
  }
}

function writeStoredStyleId(styleId: string | null): void {
  try {
    if (styleId === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, styleId)
  } catch (err) {
    console.warn('[uiWorkbench] 新矩形默认样式写入失败', { key: STORAGE_KEY, styleId, err })
  }
}

/** 启动时:记着的样式还在就以它的定义起步,否则内置默认 */
function initialDefaults(): RectNode {
  const base = builtinDefaults()
  const look = resolveLinkedLook({ ...base, styleId: readStoredStyleId() }, getStyles())
  return look.styleId === null ? base : applyRectPatch(base, look)
}

let defaults: RectNode = initialDefaults()
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function commit(next: RectNode): void {
  defaults = next
  writeStoredStyleId(next.styleId)
  for (const cb of listeners) cb()
}

export function useNewRectDefaults(): RectNode {
  return useSyncExternalStore(subscribe, () => defaults)
}

export const newRectDefaultsActions = {
  patch(patch: RectPatch): void {
    commit(applyRectPatch(defaults, patch))
  },
  /** 记下「刚用过这个样式」(应用/保存到矩形时调用):之后画的新矩形沿用它;
   *  null = 刚选了「无样式」,新矩形回内置默认 */
  rememberStyle(styleId: string | null, appearance?: StyleAppearance): void {
    if (styleId === null || !appearance) {
      commit(builtinDefaults())
      return
    }
    commit(applyRectPatch(defaults, { ...appearance, styleId }))
  }
}

/** 取画新矩形用的外观:挂着样式时取样式的最新定义(同名覆盖后跟着变);样式已被删则按无样式 */
export function getNewRectAppearance(): NewRectAppearance {
  const { fill, stroke, radii, styleId } = defaults
  return resolveLinkedLook({ fill, stroke, radii, styleId }, getStyles())
}
