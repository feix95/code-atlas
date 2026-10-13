// 「新直线默认外观」仓库:直线工具选中、画布无选中时,属性面板编辑的就是它;
// 之后画出的每条直线以此为初始外观。模块单例 + 订阅(与 newRectDefaultsStore 同一做法)。
// 默认外观本身只活在内存(重启回 1px 黑线),唯一持久的是「最近使用的已保存直线样式 id」:
// 应用/保存过某个样式后,下次画新线沿用它(跨重启),直到换样式或选「无样式」(回内置默认)。
import { useSyncExternalStore } from 'react'
import { applyLinePatch, createLine, type LineNode, type LinePatch } from '@shared/uiWorkbench/line'
import {
  lineAppearanceOf,
  resolveLinkedLineLook,
  type LineAppearance
} from '@shared/uiWorkbench/lineStyles'
import { getLineStyles } from './lineStyleStore'

/** 默认外观的承载节点:端点固定为预览用横线,不进文档 */
const PREVIEW_LENGTH = 100
const STORAGE_KEY = 'atlas.uiWorkbench.newLineStyleId'

export type NewLineAppearance = Pick<LineNode, 'stroke' | 'cap' | 'styleId'>

function builtinDefaults(): LineNode {
  return createLine([], { x1: 0, y1: 0, x2: PREVIEW_LENGTH, y2: 0 })
}

function readStoredStyleId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch (err) {
    console.warn('[uiWorkbench] 新直线默认样式读取失败,回落内置默认', { key: STORAGE_KEY, err })
    return null
  }
}

function writeStoredStyleId(styleId: string | null): void {
  try {
    if (styleId === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, styleId)
  } catch (err) {
    console.warn('[uiWorkbench] 新直线默认样式写入失败', { key: STORAGE_KEY, styleId, err })
  }
}

/** 启动时:记着的样式还在就以它的定义起步,否则内置默认 */
function initialDefaults(): LineNode {
  const base = builtinDefaults()
  const look = resolveLinkedLineLook({ ...base, styleId: readStoredStyleId() }, getLineStyles())
  return look.styleId === null ? base : applyLinePatch(base, look)
}

let defaults: LineNode = initialDefaults()
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function commit(next: LineNode): void {
  defaults = next
  writeStoredStyleId(next.styleId)
  for (const cb of listeners) cb()
}

export function useNewLineDefaults(): LineNode {
  return useSyncExternalStore(subscribe, () => defaults)
}

export const newLineDefaultsActions = {
  patch(patch: LinePatch): void {
    commit(applyLinePatch(defaults, patch))
  },
  /** 记下「刚用过这个样式」(应用/保存到直线时调用):之后画的新线沿用它;
   *  null = 刚选了「无样式」,新线回内置默认 */
  rememberStyle(styleId: string | null, appearance?: LineAppearance): void {
    if (styleId === null || !appearance) {
      commit(builtinDefaults())
      return
    }
    commit(applyLinePatch(defaults, { ...lineAppearanceOf(appearance), styleId }))
  }
}

/** 取画新直线用的外观:挂着样式时取样式的最新定义(同名覆盖后跟着变);样式已被删则按无样式 */
export function getNewLineAppearance(): NewLineAppearance {
  const { stroke, cap, styleId } = defaults
  return resolveLinkedLineLook({ stroke: { ...stroke }, cap, styleId }, getLineStyles())
}
