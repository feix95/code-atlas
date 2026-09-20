import { useEffect, useRef, useState } from 'react'
import { type ChatMessage } from '../useAiChat'
import type { BubbleResizeDir } from '@shared/types'
import { TreeIcon } from './Icons'
import './bubble.css'

/**
 * 气泡聊天页(?view=bubble,桌宠气泡锤):桌宠旁边弹出的聊天小窗。
 * 共享自由对话形态 —— 气泡是主窗公用场的影子窗:
 * 看的是主进程镜像来的同一份消息流,输入经主进程转回主窗;全 app 一场对话。
 * (右键问一问/划词问一问已下线:文件/划词两种形态一并拆走)
 *
 * 气泡放大锤(2026-09-21):窗框能拖了 —— 四角+四边中段的隐形热区,
 * hover 浮出小角标;输入舱换多行款,五行封顶、拨杆再撑五行,贴大段不抓瞎。
 */

/** 八个缩放手柄位:四角 + 四边中段 */
const GRIP_DIRS: BubbleResizeDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** 灰字条的人话版(共享形态):step = 翻文件步骤原文;summary = 摘要卡;
 * matches = 命中清单(结构化卡从简,只报数);普通 note 原样显示 */
function noteText(m: ChatMessage): string {
  if (m.kind === 'summary') return `对话摘要:${m.text}`
  if (m.kind === 'matches') return `小探针翻「${m.matches?.keyword ?? ''}」命中 ${m.matches?.items.length ?? 0} 处`
  return m.text
}

/** 输入舱行高量不出时的兜底(和 bubble.css 里 textarea 的 line-height 一口约定) */
const LINE_FALLBACK = 20
/** 自动长高封顶行数;拨杆撑开后给这么多行(口径照搬主窗输入舱) */
const CAP_LINES = 5
const EXPAND_LINES = 10

/** 共享自由对话形态(桌宠气泡锤):主窗公用场的影子窗 ——
 * 看的是主进程镜像来的同一份消息流,输入经主进程转回主窗干活。
 * 气泡自己不记账:关掉重开还是那一场,主窗发的这边同步看得见。
 * 首版只做「看 + 说」:新对话/压缩/开关回主面板操作。 */
export function BubblePage(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  // 输入舱弹性长高(气泡放大锤,口径照搬主窗):自动长到五行封顶,
  // 封顶后右上角浮拨杆,拨上去固定十行、内容舱内滚;字删回五行内拨杆自动收
  const [lineCount, setLineCount] = useState(1)
  const [expanded, setExpanded] = useState(false)

  // 开窗先拉主进程缓存的最新快照追平,之后吃增量推送;快照没来过 = 主窗还没醒
  useEffect(() => {
    let alive = true
    void window.atlas.freechatPull().then((m) => {
      if (alive && m) setMessages(m)
    })
    const off = window.atlas.onFreechatPush(setMessages)
    return () => {
      alive = false
      off()
    }
  }, [])

  // 新话落地滚到底,跟着对话走
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  // 量行数改高度:scrollHeight 含上下 padding,量行要剔掉、定高要加回(连边框)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const st = getComputedStyle(el)
    const line = Number.parseFloat(st.lineHeight) || LINE_FALLBACK
    const padV = (Number.parseFloat(st.paddingTop) || 0) + (Number.parseFloat(st.paddingBottom) || 0)
    const borderV = (Number.parseFloat(st.borderTopWidth) || 0) + (Number.parseFloat(st.borderBottomWidth) || 0)
    el.style.height = 'auto'
    const realLines = Math.max(1, Math.round((el.scrollHeight - padV) / line))
    const shown = Math.min(realLines, CAP_LINES)
    el.style.height = `${(expanded ? EXPAND_LINES : shown) * line + padV + borderV}px`
    setLineCount(shown)
    if (expanded && realLines < CAP_LINES) setExpanded(false)
  }, [draft, expanded])
  const capped = lineCount >= CAP_LINES || expanded

  const busy = (messages ?? []).some((m) => m.role === 'assistant' && m.state === 'busy')
  const ready = messages !== null

  function send(): void {
    const text = draft.trim()
    if (!text || busy || !ready) return
    window.atlas.freechatInput({ op: 'send', text })
    setDraft('')
    if (expanded) setExpanded(false)
  }

  /** 回车发送,Shift+回车换行;输入法选词的那下回车不是发送(口径照搬主窗) */
  function onDraftKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey) return
    if (e.nativeEvent.isComposing) return
    e.preventDefault()
    send()
  }

  // ── 拖拽缩放(气泡放大锤):透明无边框窗没系统手柄,热区自己画在卡片内沿。
  // 三连:按下报方向+起点光标,拖动报当前光标,松手收尾记账;对账全在主进程。
  // 热区只认指针捕获在身时才报 move/up —— 没按下时滑过不算数
  function gripDown(dir: BubbleResizeDir): (e: React.PointerEvent<HTMLDivElement>) => void {
    return (e) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      window.atlas.bubbleResize({ phase: 'begin', dir, x: e.screenX, y: e.screenY })
    }
  }
  function gripMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    window.atlas.bubbleResize({ phase: 'move', x: e.screenX, y: e.screenY })
  }
  function gripUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    window.atlas.bubbleResize({ phase: 'end' })
  }

  return (
    <div className="bubble-root">
      <div className="bubble-card">
        <div className="bubble-head">
          <span className="bubble-title" title="和主面板里的是同一场对话">
            Atlas 小探针
          </span>
          <button type="button" className="bubble-tool" onClick={() => window.atlas.openMainPanel()} title="打开主面板接着聊">
            回主面板
          </button>
        </div>
        <div className="bubble-messages">
          {!ready && <div className="bubble-note">主面板还没醒,等它一下再聊……</div>}
          {ready && messages.length === 0 && <div className="bubble-note">随便聊点什么,这边和主面板是同一场对话</div>}
          {(messages ?? []).map((m) =>
            m.role === 'note' ? (
              m.text.trim() === '' && m.kind !== 'matches' ? null : (
                <div key={m.key} className="bubble-note">
                  {noteText(m)}
                </div>
              )
            ) : (
              <div key={m.key} className={`bubble-msg bubble-${m.role} is-${m.state}`}>
                {m.reasoning ? (
                  <details className="bubble-reasoning">
                    <summary>小探针的思考过程</summary>
                    {m.reasoning}
                  </details>
                ) : null}
                {m.text}
                {m.state === 'busy' && m.text === '' && !m.reasoning && <span className="bubble-typing">小探针在想…</span>}
              </div>
            )
          )}
          <div ref={bottomRef} />
        </div>
        <div className="bubble-inputrow">
          <div className={`bubble-inputwrap${capped ? ' is-capped' : ''}`}>
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onDraftKeyDown}
              placeholder={!ready ? '等主面板醒…' : busy ? '小探针在想…' : '随便聊点什么……'}
              disabled={!ready || busy}
            />
            {capped && (
              <button
                type="button"
                className="bubble-expand"
                onClick={() => setExpanded(!expanded)}
                aria-label={expanded ? '收合输入框' : '展开输入框'}
                title={expanded ? '收合' : '多撑五行'}
              >
                <TreeIcon name={expanded ? 'collapse' : 'expand'} size={12} />
              </button>
            )}
          </div>
          <button type="button" onClick={send} disabled={!ready || busy || !draft.trim()}>
            发送
          </button>
        </div>
        {/* 缩放手柄层:贴卡片内沿的隐形热区,hover 浮出角标/短线。
            必须压在卡片不透明像素上 —— 外圈那圈透明 padding 是穿透的,接不住鼠标 */}
        {GRIP_DIRS.map((d) => (
          <div
            key={d}
            className={`bubble-grip bg-${d}`}
            onPointerDown={gripDown(d)}
            onPointerMove={gripMove}
            onPointerUp={gripUp}
            onPointerCancel={gripUp}
          />
        ))}
      </div>
    </div>
  )
}
