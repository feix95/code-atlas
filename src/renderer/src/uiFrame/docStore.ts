// UI 框架的方案账本:当前方案 + 撤销 / 重做栈。模块级单例,关掉页签再打开改动仍在(本次运行内)。
// 「我的方案」落盘属于 M1(§5.8),这里只管内存。
import { useSyncExternalStore } from 'react'
import { defaultDoc, defaultTokens } from '@shared/uiFrame/template'
import type { IconSlot, TokenValue, UiFrameDoc } from '@shared/uiFrame/types'

/** 撤销栈上限 */
const HISTORY_LIMIT = 100

interface DocState {
  doc: UiFrameDoc
  past: UiFrameDoc[]
  future: UiFrameDoc[]
}

let state: DocState = { doc: defaultDoc(), past: [], future: [] }
const listeners = new Set<() => void>()

function emit(next: DocState): void {
  state = next
  for (const l of listeners) l()
}

function commit(nextDoc: UiFrameDoc): void {
  emit({ doc: nextDoc, past: [...state.past, state.doc].slice(-HISTORY_LIMIT), future: [] })
}

const DEFAULTS = defaultTokens()

function sameValue(a: TokenValue, b: TokenValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export const docActions = {
  setToken(name: string, value: TokenValue): void {
    const def = state.doc.tokens[name]
    if (!def || sameValue(def.value, value)) return
    commit({ ...state.doc, tokens: { ...state.doc.tokens, [name]: { ...def, value } } })
  },
  resetToken(name: string): void {
    const original = DEFAULTS[name]
    if (original) docActions.setToken(name, original.value)
  },
  setIcon(slot: IconSlot, icon: string): void {
    if (state.doc.icons[slot] === icon) return
    commit({ ...state.doc, icons: { ...state.doc.icons, [slot]: icon } })
  },
  resetAll(): void {
    commit(defaultDoc())
  },
  undo(): void {
    const prev = state.past[state.past.length - 1]
    if (!prev) return
    emit({ doc: prev, past: state.past.slice(0, -1), future: [state.doc, ...state.future] })
  },
  redo(): void {
    const next = state.future[0]
    if (!next) return
    emit({ doc: next, past: [...state.past, state.doc], future: state.future.slice(1) })
  }
}

/** 该变量是否已偏离模板默认值 */
export function isTokenEdited(doc: UiFrameDoc, name: string): boolean {
  const original = DEFAULTS[name]
  return !!original && !sameValue(original.value, doc.tokens[name]?.value ?? original.value)
}

export function defaultTokenValue(name: string): TokenValue | undefined {
  return DEFAULTS[name]?.value
}

/** 当前方案快照(非订阅读取:画布重建文档时取一次) */
export function currentDoc(): UiFrameDoc {
  return state.doc
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useUiFrameDoc(): DocState {
  return useSyncExternalStore(subscribe, () => state)
}
