// 代码预览的偏好开关:存 localStorage(界面的事,每台机器自己一套,不进 AI 配置文件)。
// 第一条:自动换行 —— 默认开;关掉回到长行横向滚动。超行数闸的文件折行摁不动,
// 这个偏好只是「想要不要」,给不给是行数闸说了算(见 CodePreview 的 WRAP_MAX_LINES)。
//
// 账本挂成可订阅小 store(页签右键菜单和编辑器 Alt+Z 共拨这一颗开关):
// getCodeWrapOn 读快照、subscribeCodeWrap 挂听写变化、toggleCodeWrap 是唯一写口。

import { readFlagPref, writeFlagPref } from '../../shared/localPrefs.ts'

export const CODE_WRAP_KEY = 'atlas.codeWrap'

let wrapOn = readFlagPref(CODE_WRAP_KEY, true)
const listeners = new Set<() => void>()

export function getCodeWrapOn(): boolean {
  return wrapOn
}

/** 挂听写变化(React 侧配 useSyncExternalStore 用):返回退订函数 */
export function subscribeCodeWrap(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 唯一写口:翻账 → 落盘 → 喊醒本窗订阅者 */
export function toggleCodeWrap(): void {
  wrapOn = !wrapOn
  writeFlagPref(CODE_WRAP_KEY, wrapOn)
  listeners.forEach((fn) => fn())
}

// 撕出去的子窗是同一份 localStorage 的另一个 realm:那边翻账喊不动本窗 listeners,
// 靠 storage 事件回流对齐(删键 = 回默认开)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== CODE_WRAP_KEY) return
    const next = e.newValue === null ? true : e.newValue === 'on'
    if (next === wrapOn) return
    wrapOn = next
    listeners.forEach((fn) => fn())
  })
}
