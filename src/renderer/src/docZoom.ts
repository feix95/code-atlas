// 内容字号缩放的渲染端登记(预览/译文 + 自由对话两本账):localStorage 存档 + 订阅广播。
// 同一套滚轮逻辑只换存档键:系数落各自的 CSS 变量,界面缩放(uiScale)另有一本账,互不影响。
// 同进程模块单例 —— 子窗 Portal 共享同一个 JS heap,一处滚轮全场同类内容一起换档;
// localStorage 按 origin 共享,主窗/子窗读写同一格存档,不需要 IPC。
import { useSyncExternalStore } from 'react'
import { clampDocZoom, DOC_ZOOM_STEP } from '@shared/docZoom'

/** 滚轮一格的像素门槛 / 碎步账的保鲜期(和界面缩放滚轮同脾气) */
const WHEEL_NOTCH = 100
const WHEEL_ACC_TTL_MS = 400

interface ContentZoom {
  get: () => number
  set: (next: number) => void
  subscribe: (cb: () => void) => () => void
  useZoom: () => number
  bindWheel: (el: HTMLElement) => () => void
}

function createContentZoom(key: string): ContentZoom {
  function readStored(): number {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? 1 : clampDocZoom(Number(raw))
    } catch {
      return 1
    }
  }

  let zoom = readStored()
  const listeners = new Set<() => void>()

  const get = (): number => zoom

  const set = (next: number): void => {
    const f = clampDocZoom(next)
    if (f === zoom) return
    zoom = f
    try {
      localStorage.setItem(key, String(f))
    } catch {
      // 存档写不进不挡缩放 —— 大不了下回开回 100%
    }
    for (const cb of listeners) cb()
  }

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }

  /** 组件订阅档:返回当前系数,改动即重渲 */
  const useZoom = (): number => useSyncExternalStore(subscribe, get)

  /** 把 Ctrl/Cmd+滚轮接到内容滚动层上:碎步积累成整档才翻,捏合白捡。 */
  const bindWheel = (el: HTMLElement): (() => void) => {
    let acc = 0
    let last = 0
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      const now = performance.now()
      if (now - last > WHEEL_ACC_TTL_MS) acc = 0
      last = now
      acc += dy
      const steps = Math.trunc(acc / WHEEL_NOTCH)
      if (steps === 0) return
      acc -= steps * WHEEL_NOTCH
      set(get() - steps * DOC_ZOOM_STEP) // 向下滚(deltaY>0)= 缩小
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }

  return { get, set, subscribe, useZoom, bindWheel }
}

/** 预览/译文的文档字号:阅读档与译文栏共用一本账 */
const docZoom = createContentZoom('atlas.docZoom')
/** 自由对话的字号:和预览分开记,聊天放大不带动代码正文 */
const chatZoom = createContentZoom('atlas.chatZoom')

// 预览侧的旧入口保持原名,调用方不用改
export const getDocZoom = docZoom.get
export const setDocZoom = docZoom.set
export const subscribeDocZoom = docZoom.subscribe
export const useDocZoom = docZoom.useZoom
export const bindDocZoomWheel = docZoom.bindWheel

// 自由对话侧入口
export const useChatZoom = chatZoom.useZoom
export const bindChatZoomWheel = chatZoom.bindWheel
