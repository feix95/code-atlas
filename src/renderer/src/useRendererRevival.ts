// 画面韧性(救生圈):心跳证明 React 树还活着,断线被主进程重接后弹一句人话。
import { useEffect } from 'react'
import type { RendererRevivedKind } from '@shared/types'
import { useFlashValue } from './useFlashFlag'

/** 复活横幅停留时长:弹够看一眼,自己退场 */
const REVIVED_MS = 15_000

/**
 * 画面心跳 + 复活横幅。心跳从 React 树内发出 —— 树活着才跳;哪天渲染期异常把整棵树卸了,
 * 本 effect 的清账函数停掉 rAF,主进程看门狗 10 秒内发现心跳停摆,自动整页重挂救回。
 * StrictMode 下挂两遍也安全:每个实例只取消自己的那一跳。
 * 返回值是这次复活的方式,横幅据此说「页面内容仍在」还是「聊天记录未保留」。
 */
export function useRendererRevival(): RendererRevivedKind | null {
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

  const [revived, flashRevived] = useFlashValue<RendererRevivedKind | null>(null)
  // 画面断了被主进程重接回来时弹一句人话,十几秒后自己退场
  useEffect(() => {
    const off = window.atlas.onRendererRevived((kind) => flashRevived(kind, REVIVED_MS))
    return off
  }, [flashRevived])
  return revived
}
