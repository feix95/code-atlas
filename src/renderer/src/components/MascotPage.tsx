import { useEffect, useRef, useState } from 'react'
import type { ModelStatus } from '@shared/types'
import './mascot.css'

/**
 * 桌宠页(?view=mascot,桌宠托管第二锤):独立透明小窗里的一只小生物。
 * 动画按小葵拍板先走临时形状(CSS 画的圆家伙),正式素材画好后换皮不换机制。
 * 状态听现成的模型广播(atlas:model-status),不另埋点:
 * 思考中 = AI 请求已发出、回答未到;说话 = 回答刚送达的几秒;其余时候待机呼吸。
 * 交互:按住可拖(拖走的位置主进程记档),按下后几乎没挪 = 点击 → 唤回主面板 + 弹一下。
 */

type Mood = 'idle' | 'thinking' | 'speaking'

/** 按下到松开挪动不超过这么多像素,就算「点击」而不是「拖走」 */
const CLICK_SLOP_PX = 6
/** 回答送达后「说话」状态的展示时长 */
const SPEAK_MS = 4000

export function MascotPage(): React.JSX.Element {
  const draggingRef = useRef(false)
  const downPointRef = useRef<{ x: number; y: number } | null>(null)
  const moodRef = useRef<Mood>('idle')
  const speakTimerRef = useRef<number | null>(null)
  const [mood, setMood] = useState<Mood>('idle')
  // 弹跳计数:每次点击 +1,当 key 用 —— key 一变 DOM 重建,boing 动画从头放
  const [boing, setBoing] = useState(0)

  useEffect(() => {
    moodRef.current = mood
  }, [mood])

  // 忙闲听广播:busy/loading = 思考中;从思考里回落 = 刚答完,说话几秒再回待机。
  // 闲时的例行广播(轮询探测/热身结束)不该惊动它:只有从 thinking 出发才算「答完了」
  useEffect(
    () =>
      window.atlas.onModelStatus((status: ModelStatus) => {
        const busy = status.state === 'busy' || status.state === 'loading'
        if (busy) {
          if (speakTimerRef.current) {
            window.clearTimeout(speakTimerRef.current)
            speakTimerRef.current = null
          }
          moodRef.current = 'thinking'
          setMood('thinking')
          return
        }
        if (moodRef.current !== 'thinking') return
        if (speakTimerRef.current) window.clearTimeout(speakTimerRef.current)
        speakTimerRef.current = window.setTimeout(() => {
          speakTimerRef.current = null
          moodRef.current = 'idle'
          setMood('idle')
        }, SPEAK_MS)
        moodRef.current = 'speaking'
        setMood('speaking')
      }),
    []
  )

  // 光标跟踪 + 拖动跟随:只把光标的屏幕坐标报给主进程,「在不在小家伙身上」由那边
  // 拿窗的真实位置判定 —— 以前渲染层拿 clientX 自己算,穿透模式下收到的坐标可能
  // 和窗对不上,算出来永远「不在身上」,窗一直穿透,拖和点全漏到桌面(拖不动的病根)
  useEffect(() => {
    let lastX = NaN
    let lastY = NaN
    const onMove = (e: MouseEvent): void => {
      // 拖动中只发「跟着挪窗」,位置报信主进程反正不看(它在锁实心)
      if (draggingRef.current) {
        window.atlas.mascotDragMove()
        return
      }
      const x = Math.round(e.screenX)
      const y = Math.round(e.screenY)
      if (x !== lastX || y !== lastY) {
        lastX = x
        lastY = y
        window.atlas.mascotMouse({ x, y })
      }
    }
    const onLeave = (): void => {
      lastX = NaN
      lastY = NaN
      window.atlas.mascotMouse(null)
    }
    const onUp = (e: MouseEvent): void => {
      if (!draggingRef.current) return
      draggingRef.current = false
      window.atlas.mascotDragEnd()
      const down = downPointRef.current
      downPointRef.current = null
      if (down && Math.hypot(e.screenX - down.x, e.screenY - down.y) < CLICK_SLOP_PX) {
        window.atlas.mascotActivate()
        setBoing((n) => n + 1)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // 光标甩出窗口时没有 mousemove 可收 —— 穿透开着时 Electron 会补送 mouseleave,
    // 靠它把「不在身上」报出去,不然窗卡成实心、透明区把桌面点击也挡住
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  return (
    <div className={`mascot-root mascot-${mood}`}>
      <div
        key={boing}
        className={`mascot-body${boing > 0 ? ' mascot-boing' : ''}`}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          draggingRef.current = true
          downPointRef.current = { x: e.screenX, y: e.screenY }
          window.atlas.mascotDragStart()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          window.atlas.mascotMenu()
        }}
      >
        <div className="mascot-face">
          <span className="mascot-eye mascot-eye-left" />
          <span className="mascot-eye mascot-eye-right" />
          <span className="mascot-mouth" />
        </div>
        <div className="mascot-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  )
}
