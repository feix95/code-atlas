import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatCodeRef, ChatContextAttachment, WebLookupMeta } from '@shared/types'
import { formatStreamStats, formatUsage } from '@shared/aiText'
import { Badge } from './DetailHeader'
import { Notice } from './Notice'
import { AtlasProbe, type ProbeState } from './AtlasProbe'
import { IconRefresh, TreeIcon } from './Icons'
import { MiniMD } from './MiniMD'
import type { AiChatApi, ChatMessage } from '../useAiChat'

/**
 * 自由对话面板:和 Atlas 小探针开放式聊天,问题不限于当前文件。
 * 资料附件卡常驻顶部(默认收起,展开能看机器扫到的原始资料);
 * 助手消息带小探针头像,本轮动过联网就在消息下方挂程序记账的状态标签。
 * 示例问题点了直接发(和手动输入同一条路),不是仅有的问法。
 * 第一百一十一锤:预览模式下左栏选中的代码以引用卡挂在这儿,和问题一起发出去。
 */

const CHAT_EXAMPLES = ['你是谁？', '联网搜一下它是什么', '今天不想聊代码,讲点轻松的']

/** 只引了代码没写字时替他说一句(主进程也有同一句兜底) */
const REF_ONLY_QUESTION = '讲讲选中的这段代码'

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

/** 思考过程折叠块(第一百一十五锤):边想边展开,答完自动收起,想看随时点开。
 * 用户亲手点过就以用户为准(null = 还没点过,默认「忙着就开,答完就收」) */
function ThinkingBlock({ reasoning, busy }: { reasoning: string; busy: boolean }): React.JSX.Element | null {
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? busy
  if (reasoning.trim() === '') return null
  return (
    <div className={`chat-thinking${open ? ' is-open' : ''}`}>
      <button type="button" className="chat-thinking-toggle" onClick={() => setToggled(!open)} aria-expanded={open}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        思考过程
        <span className="chat-thinking-len">{reasoning.length.toLocaleString('en-US')} 字</span>
      </button>
      {open && <div className="chat-thinking-body">{reasoning}</div>}
    </div>
  )
}

function AssistantBubble({ msg, canRetry, onRetry }: { msg: ChatMessage; canRetry?: boolean; onRetry?: () => void }): React.JSX.Element {
  const label = webLabel(msg.web)
  const probe: ProbeState = msg.state === 'busy' ? 'thinking' : msg.state === 'error' ? 'error' : 'idle'
  // 已复制提示(第一百零七锤补):按小提示走,1 秒自己退场
  const [copied, setCopied] = useState(false)
  function copyAnswer(): void {
    void navigator.clipboard.writeText(msg.text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 800)
    })
  }
  // 复制/重试这一小排:有 token 账时贴在账目右边同行,没账时自己在正文下面一行
  const showActions = (msg.state === 'done' || msg.state === 'cancelled') && msg.text !== ''
  const actions = showActions && (
    <div className="msg-actions">
      {copied && (
        <span className="msg-copied" role="status">
          已复制
        </span>
      )}
      <button
        type="button"
        className="msg-action"
        onClick={copyAnswer}
        aria-label={copied ? '已复制' : '复制这条回答'}
        title={copied ? '已复制' : '复制'}
      >
        <TreeIcon name="copy" size={13} />
      </button>
      {canRetry && onRetry && (
        <button type="button" className="msg-action" onClick={onRetry} aria-label="重试生成" title="重试">
          <IconRefresh size={13} />
        </button>
      )}
    </div>
  )
  return (
    <div className="chat-turn">
      <div className="chat-answer-row">
        <AtlasProbe state={probe} className="chat-avatar" />
        <div className="message answer">
          {msg.state === 'busy' && !msg.text && !msg.reasoning && <span className="chat-typing">小探针正在思考……</span>}
          {msg.reasoning && <ThinkingBlock reasoning={msg.reasoning} busy={msg.state === 'busy'} />}
          {msg.text && <MiniMD text={msg.text} caret={msg.state === 'busy'} />}
          {msg.state === 'done' && !msg.text && msg.reasoning && (
            <span className="chat-typing chat-muted">想完了但没写出答案 —— 字数可能用尽了,再问一次或关掉思考模式试试。</span>
          )}
          {msg.state === 'cancelled' && !msg.text && <span className="chat-typing">已停下。</span>}
          {msg.state === 'cancelled' && msg.text && <div className="chat-typing chat-muted">已停下,上面是已经生成的部分。</div>}
          {msg.state === 'error' && <Notice kind="error">{msg.text}</Notice>}
          {/* 实时 token 账(第八十四锤):引擎报几笔显示几笔,不报就 ourselves 数字数,绝不编 */}
          {msg.state === 'busy' && (msg.stats || msg.text) && (
            <div className="chat-stats">{msg.stats ? formatStreamStats(msg.stats) : `已吐 ${msg.text.length.toLocaleString('en-US')} 字`}</div>
          )}
          {/* 复制/重试:有 token 账时和账同一行、贴在右边(小葵点的红框位置) */}
          {showActions && !msg.usage && actions}
          {msg.state !== 'busy' && msg.usage && (
            <div className="chat-stats chat-usage">
              <span>本次 · {formatUsage(msg.usage)}</span>
              {actions}
            </div>
          )}
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

export function FreeChatPanel({
  chat,
  context,
  refs,
  onRemoveRef,
  suggestions,
  onDropNode
}: {
  chat: AiChatApi
  context: ChatContextAttachment | null
  /** 已引用的代码段(第一百一十一锤):预览模式下由左栏选中攒出来 */
  refs?: ChatCodeRef[]
  onRemoveRef?: (index: number) => void
  /** 随对话演进的推荐问题(第一百一十二锤):传了就一直挂着,不传就退回开场示例 */
  suggestions?: string[]
  /** 拖文件进聊天挂引用(第一百二十五锤):传了才接拖拽;文件夹/读不了的由 App 端垫灰字指路 */
  onDropNode?: (kind: 'file' | 'folder', relPath: string) => void
}): React.JSX.Element {
  const draftRefs = refs ?? []
  const [draft, setDraft] = useState('')
  // 拖拽悬停的亮框提示:松手就挂上,不用文案教
  const [dragOver, setDragOver] = useState(false)
  // 高度拨杆(小葵点名):到五行才亮,拨上去多撑五行空白,拨回来;文字退回五行内自动归位
  const [expanded, setExpanded] = useState(false)
  // 现在文字占了几行(按实际渲染量出来的,换行/自动折行都算);一行 = 单行胶囊
  const [lineCount, setLineCount] = useState(1)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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
    sendDraft()
  }

  function sendDraft(): void {
    const q = draft.trim()
    // 挂了引用就允许空着发:这时替他说一句「讲讲选中的这段代码」,不让他对着空气发呆
    const text = q || (draftRefs.length > 0 ? REF_ONLY_QUESTION : '')
    if (!text || chat.busy) return
    forceBottom()
    chat.send(text, draftRefs)
    setDraft('')
    if (expanded) setExpanded(false)
  }

  /** 回车发送,Shift+回车换行;输入法选词的那下回车不是发送(第一百一十八锤补) */
  function onDraftKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey) return
    if (e.nativeEvent.isComposing) return
    e.preventDefault()
    sendDraft()
  }

  /** 示例问题点了直接发,跟输入框发送走同一条流程;小探针忙着回上一题就不接 */
  function sendExample(q: string): void {
    if (chat.busy) return
    forceBottom()
    chat.send(q, draftRefs)
  }

  // 弹性长高的账(小葵点名):空 = 一行;有一到四行长到几行;五行封顶,
  // 拨杆拨上去多给五行(共十行),超出的舱内自己滚;文字退回五行内拨杆自动归位
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 24
    el.style.height = 'auto'
    const realLines = Math.max(1, Math.round(el.scrollHeight / line))
    // 十行锁死(小葵点名):展开就是十行高,内容超了右侧滚条翻看,舱绝不跟着内容再长
    el.style.height = `${expanded ? 10 * line : Math.min(el.scrollHeight, 5 * line)}px`
    setLineCount(realLines)
    if (expanded && realLines < 5) setExpanded(false)
  }, [draft, expanded])
  const capped = lineCount >= 5 || expanded

  return (
    <div
      className={`chat-shell free-chat${dragOver ? ' is-dragover' : ''}`}
      onDragOver={
        onDropNode
          ? (e) => {
              if (!e.dataTransfer.types.includes('application/x-atlas-node')) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              setDragOver(true)
            }
          : undefined
      }
      onDragLeave={
        onDropNode
          ? (e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return
              setDragOver(false)
            }
          : undefined
      }
      onDrop={
        onDropNode
          ? (e) => {
              setDragOver(false)
              const raw = e.dataTransfer.getData('application/x-atlas-node')
              if (!raw) return
              e.preventDefault()
              try {
                const node = JSON.parse(raw) as { kind: 'file' | 'folder'; relPath: string }
                if (node.relPath) onDropNode(node.kind, node.relPath)
              } catch {
                // 不是咱家的货,不接
              }
            }
          : undefined
      }
    >
      {context && (
        <details className="chat-attach">
          <summary>
            <TreeIcon name="clip" size={12} />
            当前参考资料:<strong>{context.name}</strong>
            <span className="chat-attach-summary">{context.summary}</span>
          </summary>
          <pre className="chat-attach-details">{context.details}</pre>
        </details>
      )}
      {/* 开场白和聊起来的气泡共用同一个消息区骨架:开场白也撑满中段,输入栏两种状态钉在同一个底 */}
      <div className="chat-messages-wrap">
        <div className="chat-messages" ref={scrollRef} onScroll={onMessagesScroll}>
          {chat.messages.length === 0 ? (
            <div className="chat-intro">
              <AtlasProbe state="idle" className="chat-probe" />
              <p className="chat-intro-title">我是 Atlas 小探针。</p>
              <p>
                你可以问我当前项目,也可以聊点完全无关的事情。
                {context ? '当前选中的资料会作为可选参考附在消息旁。' : '没有选中任何文件,就纯聊天。'}
              </p>
            </div>
          ) : (
            chat.messages.map((m, idx) => {
              if (m.role === 'note') {
                // 程序垫的灰字条(第一百二十四锤):像旁边有人递了份新材料,不装成谁说的话
                return (
                  <div key={m.key} className="chat-note" role="status">
                    {m.text}
                  </div>
                )
              }
              if (m.role === 'user') {
                return (
                  <div key={m.key} className="message user">
                    {m.text}
                    {/* 这轮引用过哪几段:自己发的话里留下痕迹,回看时知道当时给的是什么 */}
                    {m.refs && m.refs.length > 0 && (
                      <div className="msg-refs">
                        {m.refs.map((r, i) => (
                          <span key={`${r.relPath}-${r.startLine}-${r.endLine}-${i}`} className="msg-ref mono">
                            {r.relPath.split('/').pop()} 第 {r.startLine}-{r.endLine} 行
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              }
              // 重试只挂在最后一条回答上:重答的应该是最新这个问题,历史回答不翻烧饼
              const lastAssistantKey = [...chat.messages].reverse().find((x) => x.role === 'assistant')?.key
              return (
                <AssistantBubble
                  key={m.key}
                  msg={m}
                  canRetry={m.key === lastAssistantKey && !chat.busy}
                  onRetry={() => {
                    const prev = [...chat.messages].slice(0, idx).reverse().find((x) => x.role === 'user')
                    if (prev) {
                      forceBottom()
                      // 重试要把这轮的引用原样带上,不然重答的就不是同一道题了
                      chat.send(prev.text || REF_ONLY_QUESTION, prev.refs)
                    }
                  }}
                />
              )
            })
          )}
        </div>
        {showJump && (
          <button key={newBeat} type="button" className="chat-jump" onClick={jumpToLatest} aria-label="跳到最新消息" title="跳到最新消息">
            <i aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="chat-bottom">
        {draftRefs.length > 0 && (
          <div className="chat-refs" aria-label="已引用的代码">
            <span className="chat-refs-label">已引用</span>
            {draftRefs.map((r, i) => (
              <span key={`${r.relPath}-${r.startLine}-${r.endLine}-${i}`} className="chat-ref">
                <TreeIcon name="code" size={12} />
                <span className="chat-ref-text mono" title={`${r.relPath} 第 ${r.startLine}-${r.endLine} 行`}>
                  {r.relPath.split('/').pop()} 第 {r.startLine}-{r.endLine} 行
                </span>
                <button
                  type="button"
                  className="chat-ref-remove"
                  onClick={() => onRemoveRef?.(i)}
                  aria-label={`移除引用 ${r.relPath} 第 ${r.startLine}-${r.endLine} 行`}
                  title="移除这段引用"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {suggestions ? (
          // 预览模式:推荐问题随对话演进 —— 每答完一轮就换成下一轮该问的;忙着答题时先让位
          !chat.busy &&
          suggestions.length > 0 && (
            <div className="prompt-row">
              {suggestions.map((q) => (
                <button key={q} type="button" className="prompt" onClick={() => sendExample(q)}>
                  {q}
                </button>
              ))}
            </div>
          )
        ) : (
          chat.messages.length === 0 && (
            <div className="prompt-row">
              {CHAT_EXAMPLES.map((q) => (
                <button key={q} type="button" className="prompt" onClick={() => sendExample(q)}>
                  {q}
                </button>
              ))}
            </div>
          )
        )}
        {/* 一体化输入舱(小葵给的参考图):空时一条单行胶囊、按钮在右侧齐肩;
            写到五行封顶,右上角出现拨杆,拨上去多撑五行,再拨回来 */}
        <form
          className={`chat-input${lineCount >= 2 ? ' is-multiline' : ''}${capped ? ' is-capped' : ''}`}
          onSubmit={submit}
        >
          <textarea
            ref={inputRef}
            value={draft}
            placeholder={chat.busy ? '小探针正在回答上一个问题……' : '随便聊点什么……'}
            aria-label="输入自由对话"
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onDraftKeyDown}
          />
          {capped && (
            <button
              type="button"
              className="composer-expand"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? '收合输入框' : '展开输入框'}
              title={expanded ? '收合' : '多撑五行'}
            >
              <TreeIcon name={expanded ? 'collapse' : 'expand'} size={12} />
            </button>
          )}
          <div className="composer-bar">
            {chat.busy && (
              <button type="button" className="btn btn-ghost composer-stop" onClick={chat.cancel}>
                停一停
              </button>
            )}
            <button
              type="button"
              className={`chat-think-toggle${chat.thinking ? ' is-on' : ''}`}
              onClick={() => chat.setThinking(!chat.thinking)}
              aria-pressed={chat.thinking}
              title={
                chat.thinking
                  ? '思考模式开着:小探针会先想一遍再回答,思考过程折叠在答案上方,复杂问题更靠谱,但更慢。点一下关掉'
                  : '思考模式关着:回答快,复杂问题可能想不周全。点一下打开'
              }
            >
              <TreeIcon name="brain" size={14} />
              思考
            </button>
            <button type="submit" className="chat-send" disabled={chat.busy} aria-label={chat.busy ? '回答中' : '发送'} title={chat.busy ? '回答中……' : '发送'}>
              <TreeIcon name="arrowUp" size={19} strokeWidth={4} />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
