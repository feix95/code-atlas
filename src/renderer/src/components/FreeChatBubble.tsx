import { memo, useEffect, useRef, useState } from 'react'
import type { WebLookupMeta } from '@shared/types'
import type { FileLinkTarget } from '@shared/fileLinks'
import { formatStreamStats, formatUsage } from '@shared/aiText'
import { Badge } from './DetailHeader'
import { Notice } from './Notice'
import { IconRefresh, TreeIcon } from './Icons'
import { MiniMD } from './MiniMD'
import type { ChatMessage } from '../useAiChat'
import { CHAT_ACTION_ICON_SIZE, MSG_ACTION_ICON_SIZE } from '../inputMetrics'
import { useFlashFlag } from '../useFlashFlag'

/**
 * 自由对话的「回答件」:思考行 + 助手气泡。回答扁平化(无头像无框),
 * 思考行 = 脑图标 + 流光「正在思考」+弹跳点,想完收成「想了 Xs ▸」可点开看过程;
 * 本轮动过联网就在消息下方挂程序记账的状态标签。从 FreeChatPanel 拆出,纯搬家不改行为。
 */

/** 联网账本 → 界面标签:程序没动手脚的(not_requested)不挂标签,不刷存在感 */
function webLabel(
  meta: WebLookupMeta | null
): { text: string; tone: 'blue' | 'green' | 'amber' | 'muted' } | null {
  if (!meta || !meta.requested) return null
  switch (meta.state) {
    case 'not_requested':
      return null
    case 'disabled':
      return { text: '联网开关未开启,本轮没有查询', tone: 'muted' }
    case 'searching':
      return { text: '正在联网查询…', tone: 'blue' }
    case 'completed':
      return {
        text: `已联网查询:${meta.sources.length > 0 ? meta.sources.join('、') : '公开资料'}`,
        tone: 'green'
      }
    case 'failed':
      return { text: '联网查询失败,以下内容不是联网结论', tone: 'amber' }
    case 'empty':
      return { text: '已查询,但没有找到可用资料', tone: 'amber' }
  }
}

/** 思考行(对话页改版):脑图标 + 「正在思考」流光字+弹跳点(活着),想完就地收成「想了 Xs ▸」,
 * 点开看过程、箭头顺时针转 90° 朝下。耗时在组件里自己量:忙起来记账、闲下来结账;
 * 中途重挂(滚动记忆那套)没有起点的,就不说秒数,只叫「思考过程」。
 * 用户亲手点过就以用户为准(null = 还没点过,默认「忙着就开,答完就收」) */
function ThinkingBlock({
  reasoning,
  busy
}: {
  reasoning: string
  busy: boolean
}): React.JSX.Element | null {
  const [toggled, setToggled] = useState<boolean | null>(null)
  const [secs, setSecs] = useState<number | null>(null)
  const startRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (busy) {
      if (startRef.current === undefined) startRef.current = performance.now()
      return
    }
    if (startRef.current !== undefined)
      setSecs(Math.max(1, Math.round((performance.now() - startRef.current) / 1000)))
  }, [busy])
  const open = toggled ?? busy
  if (reasoning.trim() === '') return null
  return (
    <div className={`chat-thinking${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="chat-thinking-toggle"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
      >
        <TreeIcon name="brain" size={CHAT_ACTION_ICON_SIZE} mono />
        {busy ? (
          <>
            <span className="fc-shim">正在思考</span>
            <span className="fc-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </>
        ) : (
          <>
            {secs !== null ? `想了 ${secs}s` : '思考过程'}
            <span className="cv" aria-hidden="true">
              <TreeIcon name="chevron" size={11} mono />
            </span>
          </>
        )}
      </button>
      {open && <div className="chat-thinking-body">{reasoning}</div>}
    </div>
  )
}

// 回答气泡上 memo(隐身案这锤):流式输出每补一段字,消息区就重画一次;气泡不 memo,
// 旧消息全量陪跑,聊得越久越沉。memo 生效的前提是 props 身份稳定 —— msg 是消息对象
// 本身(流式只换正在写的那条,旧的不动)、onRetry 由父层用 ref 稳住、fileLinks 同理。
export const AssistantBubble = memo(function AssistantBubble({
  msg,
  canRetry,
  retryIndex,
  onRetry,
  fileLinks
}: {
  msg: ChatMessage
  canRetry?: boolean
  /** 重试按钮回传自己在消息列表里的座位号,回调本体在父层一个身份用到底 */
  retryIndex: number
  onRetry?: (idx: number) => void
  fileLinks?: FileLinkTarget | null
}): React.JSX.Element {
  const label = webLabel(msg.web)
  // 已复制提示(第一百零七锤补):按小提示走,1 秒自己退场
  const [copied, flashCopied] = useFlashFlag(800)
  function copyAnswer(): void {
    void navigator.clipboard.writeText(msg.text).then(flashCopied)
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
        data-tip={copied ? '已复制' : '复制'}
      >
        <TreeIcon name="copy" size={MSG_ACTION_ICON_SIZE} />
      </button>
      {canRetry && onRetry && (
        <button
          type="button"
          className="msg-action"
          onClick={() => onRetry(retryIndex)}
          aria-label="重试生成"
          data-tip="重试"
        >
          <IconRefresh size={MSG_ACTION_ICON_SIZE} />
        </button>
      )}
    </div>
  )
  return (
    <div className="chat-turn">
      <div className="message answer">
        {msg.state === 'busy' && !msg.text && !msg.reasoning && (
          <div className="chat-thinking" role="status">
            <span className="chat-thinking-toggle is-live">
              <TreeIcon name="brain" size={CHAT_ACTION_ICON_SIZE} mono />
              <span className="fc-shim">正在思考</span>
              <span className="fc-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </span>
          </div>
        )}
        {msg.reasoning && <ThinkingBlock reasoning={msg.reasoning} busy={msg.state === 'busy'} />}
        {msg.text && (
          <MiniMD text={msg.text} caret={msg.state === 'busy'} fileLinks={fileLinks ?? undefined} />
        )}
        {msg.state === 'done' && !msg.text && msg.reasoning && (
          <span className="chat-typing chat-muted">
            想完了但没写出答案 —— 字数可能用尽了,再问一次或关掉思考模式试试。
          </span>
        )}
        {msg.state === 'cancelled' && !msg.text && <span className="chat-typing">已停下。</span>}
        {msg.state === 'cancelled' && msg.text && (
          <div className="chat-typing chat-muted">已停下,上面是已经生成的部分。</div>
        )}
        {msg.state === 'error' && <Notice kind="error">{msg.text}</Notice>}
        {/* 实时 token 账(第八十四锤):引擎报几笔显示几笔,不报就 ourselves 数字数,绝不编 */}
        {msg.state === 'busy' && (msg.stats || msg.text) && (
          <div className="chat-stats">
            {msg.stats
              ? formatStreamStats(msg.stats)
              : `已吐 ${msg.text.length.toLocaleString('en-US')} 字`}
          </div>
        )}
        {/* 复制/重试:有 token 账时和账同一行、贴在右边;悬停本条回答才露脸 */}
        {showActions && !msg.usage && actions}
        {msg.state !== 'busy' && msg.usage && (
          <div className="chat-stats chat-usage">
            <span>本次 · {formatUsage(msg.usage)}</span>
            {actions}
          </div>
        )}
      </div>
      {label && (
        <div className="chat-webstatus">
          <Badge label={label.text} tone={label.tone} />
        </div>
      )}
    </div>
  )
})
