// 外观样式仓库(渲染端):localStorage + 订阅广播,同 artboardPrefsStore 的做法。
// 样式定义存本机,关掉重开不丢;节点经 styleId 挂接(活链接),改定义/删定义的回写走 docActions。
import { useSyncExternalStore } from 'react'
import {
  normalizeStyleName,
  removeStylePreset,
  sanitizeStylePresets,
  saveStylePreset,
  type RectStyle,
  type StyleAppearance
} from '@shared/uiWorkbench/styles'

const KEY = 'atlas.uiWorkbench.styles'

function readStored(): RectStyle[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === null ? [] : sanitizeStylePresets(JSON.parse(raw))
  } catch (err) {
    console.warn('[uiWorkbench] 外观样式存档读取失败,回落空表', { key: KEY, err })
    return []
  }
}

let styles = readStored()
const listeners = new Set<() => void>()

function commit(next: RectStyle[]): void {
  styles = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch (err) {
    console.warn('[uiWorkbench] 外观样式存档写入失败', { key: KEY, err })
  }
  for (const cb of listeners) cb()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useStyles(): RectStyle[] {
  return useSyncExternalStore(subscribe, () => styles)
}

export function getStyles(): RectStyle[] {
  return styles
}

export const styleActions = {
  /** 存方案:同名覆盖(沿用原 id——挂接节点靠 id 认,不会被换名弄丢);
   *  返回 { id, overwrote }:overwrote 为 true 时调用方应把新定义回写到所有挂接节点 */
  save(rawName: string, appearance: StyleAppearance): { id: string; overwrote: boolean } {
    const name = normalizeStyleName(rawName, styles.length + 1)
    const r = saveStylePreset(styles, {
      id: crypto.randomUUID(),
      name,
      fill: appearance.fill,
      stroke: appearance.stroke,
      radii: appearance.radii
    })
    commit(r.list)
    return { id: r.id, overwrote: r.overwrote }
  },
  remove(id: string): void {
    commit(removeStylePreset(styles, id))
  }
}
