import { useEffect, useRef, useState } from 'react'
import type { ModelStatus } from '@shared/types'
import './mascot.css'

/**
 * 桌宠页(?view=mascot,桌宠托管第二锤):独立透明小窗里的一只小生物。
 * 动画按小葵拍板先走临时形状(CSS 画的圆家伙),正式素材画好后换皮不换机制。
 * 状态听现成的模型广播(atlas:model-status),不另埋点:
 * 思考中 = AI 请求已发出、回答未到;说话 = 回答刚送达的几秒;其余时候待机呼吸。
 * 交互:按住可拖(拖走的位置主进程记档),按下后几乎没挪 = 点击 → 弹对话气泡 + 弹一下。
 * 「在不在小家伙身上」不用渲染层操心 —— 主进程轮询光标位置自己判,
 * Electron 的鼠标转发断不断气都跟咱无关(「又拖不动」第三案的治法,主仓趟平版移植)。
 * 藏/露听主进程(第六案):藏起 = 页面不画身体,窗的透明度从头到尾不动,合成链不断档。
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
  // 藏/露听主进程(第六案):藏起 = 页面不画身体,窗的透明度从头到尾不动,
  // 合成链不断档。挂载先拉一次再订推送 —— 藏起期间页面重载也别当幽灵
  const [petVisible, setPetVisible] = useState(true)

  useEffect(() => {
    let alive = true
    void window.atlas.mascotVisibilityGet().then((v) => {
      if (alive) setPetVisible(v)
    })
    const off = window.atlas.onMascotVisibility(setPetVisible)
    return () => {
      alive = false
      off()
    }
  }, [])

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

  // 拖动跟随:按住时每次鼠标动都让主进程跟着光标挪窗(穿透判定全在主进程,见文件头)。
  // 移动时核对左键还真按着:松手信号没传到(在窗外/焦点切换时释放)就当拖拽已结束,
  // 不然旧拖拽不咽气,桌宠变「幽灵跟手」—— 光标走到哪儿它跟到哪儿(漂移案的帮凶)
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!draggingRef.current) return
      if ((e.buttons & 1) === 0) {
        draggingRef.current = false
        downPointRef.current = null
        window.atlas.mascotDragEnd()
        return
      }
      window.atlas.mascotDragMove()
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
    <div className={`mascot-root mascot-${mood}${petVisible ? '' : ' mascot-off'}`}>
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
          // 右键本体 = 快捷菜单:收回小探针/显示·隐藏主面板/藏起自己/真退出
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
