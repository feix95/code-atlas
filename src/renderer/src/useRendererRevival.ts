// 画面韧性(救生圈):心跳证明 React 树还活着,断线被主进程重接后弹一句人话。
import { useEffect } from 'react'
import type { RendererRevivedKind } from '@shared/types'

/** 复活提示停留时长:弹够看一眼,自己退场 */
const REVIVED_MS = 15_000

/** 复活方式到人话:page = 页面状态还在;reload = 整页重挂,内存里的对话没了 */
const REVIVED_TEXT: Record<RendererRevivedKind, string> = {
  page: '画面已恢复，页面内容仍在',
  reload: '画面已恢复，聊天记录未保留'
}

/**
 * 画面心跳 + 复活提示。心跳从 React 树内发出 —— 树活着才跳;哪天渲染期异常把整棵树卸了,
 * 本 effect 的清账函数停掉 rAF,主进程看门狗 10 秒内发现心跳停摆,自动整页重挂救回。
 * StrictMode 下挂两遍也安全:每个实例只取消自己的那一跳。
 * 复活提示走全场唯一的轻提示(Toast):与其他窗口层面的提示同一个位置、同一套样式。
 */
export function useRendererRevival(showToast: (text: string, ms?: number) => void): void {
  useEffect(() => {
    let lastBeat = 0
    let handle = 0
    const beat = (t: number): void => {
      if (t - lastBeat >= 1000) {
        lastBeat = t
        window.atlas?.frameHeartbeat()
      }
      handle = requestAnimationFrame(beat)
    }
    handle = requestAnimationFrame(beat)
    return () => cancelAnimationFrame(handle)
  }, [])

  // 画面断了被主进程重接回来时弹一句人话,十几秒后自己退场
  useEffect(
    () => window.atlas.onRendererRevived((kind) => showToast(REVIVED_TEXT[kind], REVIVED_MS)),
    [showToast]
  )
}
