import { useEffect, useRef, useState } from 'react'
import { type ChatMessage } from '../useAiChat'
import './bubble.css'

/**
 * 气泡聊天页(?view=bubble,桌宠气泡锤):桌宠旁边弹出的聊天小窗。
 * 共享自由对话形态 —— 气泡是主窗公用场的影子窗:
 * 看的是主进程镜像来的同一份消息流,输入经主进程转回主窗;全 app 一场对话。
 * (右键问一问/划词问一问已下线:文件/划词两种形态一并拆走)
 */

/** 灰字条的人话版(共享形态):step = 翻文件步骤原文;summary = 摘要卡;
 * matches = 命中清单(结构化卡从简,只报数);普通 note 原样显示 */
function noteText(m: ChatMessage): string {
  if (m.kind === 'summary') return `对话摘要:${m.text}`
  if (m.kind === 'matches') return `小探针翻「${m.matches?.keyword ?? ''}」命中 ${m.matches?.items.length ?? 0} 处`
  return m.text
}

/** 共享自由对话形态(桌宠气泡锤):主窗公用场的影子窗 ——
 * 看的是主进程镜像来的同一份消息流,输入经主进程转回主窗干活。
 * 气泡自己不记账:关掉重开还是那一场,主窗发的这边同步看得见。
 * 首版只做「看 + 说」:新对话/压缩/开关回主面板操作。 */
export function BubblePage(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

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

  const busy = (messages ?? []).some((m) => m.role === 'assistant' && m.state === 'busy')
  const ready = messages !== null

  function send(): void {
    const text = draft.trim()
    if (!text || busy || !ready) return
    window.atlas.freechatInput({ op: 'send', text })
    setDraft('')
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
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !busy && draft.trim()) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={!ready ? '等主面板醒…' : busy ? '小探针在想…' : '随便聊点什么……'}
            disabled={!ready || busy}
          />
          <button type="button" onClick={send} disabled={!ready || busy || !draft.trim()}>
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
