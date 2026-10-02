// UI 框架的方案账本:当前方案文档 + 撤销 / 重做栈。模块级单例,关掉页签再打开改动仍在(本次运行内)。
// 「我的方案」落盘与库操作在 schemeStore.ts(§5.8);这里只管文档内容与历史。
import { useSyncExternalStore } from 'react'
import { defaultDeviceId, isDeviceId } from '@shared/uiFrame/devices'
import { defaultDoc, defaultTokens } from '@shared/uiFrame/template'
import { templateOverrides } from '@shared/uiFrame/templates'
import type { IconSlot, TokenValue, UiFrameDoc, UiPlatform } from '@shared/uiFrame/types'

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
  /** 切平台(§5.4 顶栏「平台」):变量保留,设备档重置为新平台默认 */
  setPlatform(platform: UiPlatform): void {
    if (state.doc.platform === platform) return
    commit({ ...state.doc, platform, device: defaultDeviceId(platform) })
  },
  setDevice(device: string): void {
    if (!isDeviceId(state.doc.platform, device) || state.doc.device === device) return
    commit({ ...state.doc, device })
  },
  /** 整份换方案(开方案/换起步模板):不进撤销栈,历史清空 */
  replaceDoc(next: UiFrameDoc): void {
    emit({ doc: next, past: [], future: [] })
  },
  /** 零件盒「风格」一键套用:把该模板的变量覆盖合进当前方案,进撤销栈可 Ctrl+Z 回退。
   *  方案名与平台/设备不动;template 记成该模板(方案库的「风格」列由它推) */
  applyTemplateStyle(templateId: string): void {
    const over = templateOverrides(templateId)
    const tokens = { ...state.doc.tokens }
    let applied = 0
    for (const [name, value] of Object.entries(over)) {
      const def = tokens[name]
      if (def) {
        tokens[name] = { ...def, value }
        applied += 1
      }
    }
    if (applied === 0 && state.doc.template === templateId) return
    commit({ ...state.doc, tokens, template: templateId })
  },
  /** 只改方案名(保存/重命名走这条):不进撤销栈 */
  renameDoc(name: string): void {
    if (state.doc.name === name) return
    emit({ ...state, doc: { ...state.doc, name } })
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
