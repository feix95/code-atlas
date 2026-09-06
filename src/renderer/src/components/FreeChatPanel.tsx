import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatContextAttachment, WebLookupMeta } from '@shared/types'
import { Badge } from './DetailHeader'
import { Notice } from './Notice'
import { AtlasProbe, type ProbeState } from './AtlasProbe'
import type { AiChatApi, ChatMessage } from '../useAiChat'

/**
 * 自由对话面板:和 Atlas 小探针开放式聊天,问题不限于当前文件。
 * 资料附件卡常驻顶部(默认收起,展开能看机器扫到的原始资料);
 * 助手消息带小探针头像,本轮动过联网就在消息下方挂程序记账的状态标签。
 * 示例问题点了直接发(和手动输入同一条路),不是仅有的问法。
 */

const CHAT_EXAMPLES = ['你是谁？', '联网搜一下它是什么', '今天不想聊代码,讲点轻松的']

/** 联网账本 → 界面标签:程序没动手脚的(not_requested)不挂标签,不刷存在感 */
function webLabel(meta: WebLookupMeta | null): { text: string; tone: 'blue' | 'green' | 'amber' | 'muted' } | null {
  if (!meta || !meta.requested) return null
  switch (meta.state) {
    case 'not_requested':
      return null
    case 'disabled':
      return { text: '联网开关未开启,本轮没有查询', tone: 'muted' }
    case 'searching':
      return { text: '正在联网查询…', tone: 'blue' }
    case 'completed':
      return { text: `已联网查询:${meta.sources.length > 0 ? meta.sources.join('、') : '公开资料'}`, tone: 'green' }
    case 'failed':
      return { text: '联网查询失败,以下内容不是联网结论', tone: 'amber' }
    case 'empty':
      return { text: '已查询,但没有找到可用资料', tone: 'amber' }
  }
}

function AssistantBubble({ msg }: { msg: ChatMessage }): React.JSX.Element {
  const label = webLabel(msg.web)
  const probe: ProbeState = msg.state === 'busy' ? 'thinking' : msg.state === 'error' ? 'error' : 'idle'
  return (
    <div className="chat-turn">
      <div className="chat-answer-row">
        <AtlasProbe state={probe} className="chat-avatar" />
        <div className="message answer">
          {msg.state === 'busy' && !msg.text && <span className="chat-typing">小探针正在思考……</span>}
          {msg.text && (
            <>
              {msg.text}
              {msg.state === 'busy' && <span className="stream-caret">▌</span>}
            </>
          )}
          {msg.state === 'cancelled' && !msg.text && <span className="chat-typing">已停下。</span>}
          {msg.state === 'cancelled' && msg.text && <div className="chat-typing chat-muted">已停下,上面是已经生成的部分。</div>}
          {msg.state === 'error' && <Notice kind="error">{msg.text}</Notice>}
        </div>
      </div>
      {label && (
        <div className="chat-webstatus">
          <Badge label={label.text} tone={label.tone} />
        </div>
      )}
    </div>
  )
}

export function FreeChatPanel({ chat, context }: { chat: AiChatApi; context: ChatContextAttachment | null }): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // 粘底跟滚(第六十一锤):消息区自己滚;贴着底部看就跟滚,上翻过就不抢滚动条,只让箭头跳一下报信
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [newBeat, setNewBeat] = useState(0)

  function onMessagesScroll(): void {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
    atBottomRef.current = nearBottom
    setShowJump(!nearBottom)
  }

  function jumpToLatest(): void {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = true
    setShowJump(false)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }

  /** 自己发消息 = 强制回底部:自己的话自己得看见,发出去这一眼不被上翻状态挡住 */
  function forceBottom(): void {
    atBottomRef.current = true
    setShowJump(false)
  }

  // 流式增量每补一段,消息数组就换一次新引用;粘着底部就压到底,不在底就让箭头 key 变一变、蹦一下
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (atBottomRef.current) el.scrollTop = el.scrollHeight
    else setNewBeat((c) => c + 1)
  }, [chat.messages])

  function submit(e: FormEvent): void {
    e.preventDefault()
    const q = draft.trim()
    if (!q || chat.busy) return
    forceBottom()
    chat.send(q)
    setDraft('')
  }

  /** 示例问题点了直接发,跟输入框发送走同一条流程;小探针忙着回上一题就不接 */
  function sendExample(q: string): void {
    if (chat.busy) return
    forceBottom()
    chat.send(q)
  }

  return (
    <div className="chat-shell free-chat">
      {context && (
        <details className="chat-attach">
          <summary>
            <span aria-hidden="true">📎</span>
            当前参考资料:<strong>{context.name}</strong>
            <span className="chat-attach-summary">{context.summary}</span>
          </summary>
          <pre className="chat-attach-details">{context.details}</pre>
        </details>
      )}
      {chat.messages.length === 0 ? (
        <div className="chat-intro">
          <AtlasProbe state="idle" className="chat-probe" />
          <p className="chat-intro-title">我是 Atlas 小探针。</p>
          <p>
            你可以问我当前项目,也可以聊点完全无关的事情。
            {context ? '当前选中的资料会作为可选参考附在消息旁。' : '现在没有选中任何文件,咱们就纯聊天。'}
          </p>
        </div>
      ) : (
        <div className="chat-messages-wrap">
          <div className="chat-messages" ref={scrollRef} onScroll={onMessagesScroll}>
            {chat.messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.key} className="message user">
                  {m.text}
                </div>
              ) : (
                <AssistantBubble key={m.key} msg={m} />
              )
            )}
          </div>
          {showJump && (
            <button key={newBeat} type="button" className="chat-jump" onClick={jumpToLatest} aria-label="跳到最新消息" title="跳到最新消息">
              <i aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <div className="chat-bottom">
        {chat.messages.length === 0 && (
          <div className="prompt-row">
            {CHAT_EXAMPLES.map((q) => (
              <button key={q} type="button" className="prompt" onClick={() => sendExample(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <form className="chat-input" onSubmit={submit}>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder={chat.busy ? '小探针正在回答上一个问题……' : '随便聊点什么……'}
            aria-label="输入自由对话"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={chat.busy}>
            {chat.busy ? '回答中……' : '发送'}
          </button>
          {chat.busy && (
            <button type="button" className="btn btn-ghost" onClick={chat.cancel}>
              停一停
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
