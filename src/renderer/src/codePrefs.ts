// 代码预览的预览显示开关:三颗全是全局一档(localStorage,重启不失忆)——
//   自动换行(默认开):关掉回到长行横向滚动。超行数闸的文件折行摁不动,
//     这个偏好只是「想要不要」,给不给是行数闸说了算(见 CodePreview 的 WRAP_MAX_LINES)。
//   只读锁(默认关):开了所有文本文件预览一律拒收改字。
//   排版显示(默认开):只对 md 系文件有生(闸在 viewState 的 canRender),开了走渲染态。
// 拨口三处共同一数据源:页签右键菜单的开关行、预览头锁钮、编辑器 Alt+Z ——
// 一拨全部已开的预览签就地翻面,新开的签与重启后都继承。
//
// 状态表挂成可订阅小 store:get 读快照、subscribe 挂听写变化、set/toggle 是唯一写口。
// 拆出去的子窗是同一份 localStorage 的另一个 realm:那边翻账喊不动本窗 listeners,
// 靠 storage 事件回流对齐(删键 = 回默认)。

import { readFlagPref, writeFlagPref } from '../../shared/localPrefs.ts'

export const CODE_WRAP_KEY = 'atlas.codeWrap'
export const PREVIEW_READONLY_KEY = 'atlas.previewReadOnly'
export const PREVIEW_RENDER_KEY = 'atlas.previewRender'

/** 一颗开关旗的小状态表:内存读数 + localStorage 落盘 + 订阅广播 + 跨 realm 回流 */
function flagPref(
  key: string,
  fallback: boolean
): {
  get: () => boolean
  subscribe: (fn: () => void) => () => void
  set: (on: boolean) => void
} {
  let on = readFlagPref(key, fallback)
  const listeners = new Set<() => void>()
  const apply = (next: boolean): void => {
    if (next === on) return
    on = next
    listeners.forEach((fn) => fn())
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== key) return
      apply(e.newValue === null ? fallback : e.newValue === 'on')
    })
  }
  return {
    get: () => on,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    set: (next) => {
      apply(next)
      writeFlagPref(key, on)
    }
  }
}

const wrap = flagPref(CODE_WRAP_KEY, true)
const readOnly = flagPref(PREVIEW_READONLY_KEY, false)
const render = flagPref(PREVIEW_RENDER_KEY, true)

export function getCodeWrapOn(): boolean {
  return wrap.get()
}

/** 挂听写变化(React 侧配 useSyncExternalStore 用):返回退订函数 */
export function subscribeCodeWrap(fn: () => void): () => void {
  return wrap.subscribe(fn)
}

/** 唯一写口:翻账 → 落盘 → 喊醒本 realm 订阅者 */
export function toggleCodeWrap(): void {
  wrap.set(!wrap.get())
}

export function getPreviewReadOnly(): boolean {
  return readOnly.get()
}

export function subscribePreviewReadOnly(fn: () => void): () => void {
  return readOnly.subscribe(fn)
}

export function setPreviewReadOnly(on: boolean): void {
  readOnly.set(on)
}

export function getPreviewRender(): boolean {
  return render.get()
}

export function subscribePreviewRender(fn: () => void): () => void {
  return render.subscribe(fn)
}

export function setPreviewRender(on: boolean): void {
  render.set(on)
}
