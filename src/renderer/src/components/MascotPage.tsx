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
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const insideRef = useRef(false)
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

  // 光标跟踪 + 拖动跟随:mousemove 里做几何判定(穿透开着时 forward:true 照样送事件),
  // 「在不在小家伙身上」变state就报给主进程切穿透;按住拖时让主进程跟着光标挪窗
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const body = bodyRef.current
      if (body) {
        const r = body.getBoundingClientRect()
        const inside =
          e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
        if (inside !== insideRef.current) {
          insideRef.current = inside
          window.atlas.mascotMouse(inside)
        }
      }
      if (draggingRef.current) window.atlas.mascotDragMove()
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
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div className={`mascot-root mascot-${mood}`}>
      <div
        key={boing}
        ref={bodyRef}
        className={`mascot-body${boing > 0 ? ' mascot-boing' : ''}`}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          draggingRef.current = true
          downPointRef.current = { x: e.screenX, y: e.screenY }
          window.atlas.mascotDragStart()
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
