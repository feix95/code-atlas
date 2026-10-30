// 对话消息列表:程序灰字条 / 用户气泡(带文件·图片·引用痕迹) / 回答气泡(单条兜底网)。
import type { FileLinkTarget } from '@shared/fileLinks'
import { fileAttachRangeLabel } from '@shared/chatFiles'
import { ErrorBoundary } from './ErrorBoundary'
import { AssistantBubble } from './FreeChatBubble'
import { FileNoteText, MatchListCard } from './FreeChatNotes'
import type { ChatMessage } from '../useAiChat'

export function FreeChatMessages({
  messages,
  lastAssistantKey,
  busy,
  retryFrom,
  fileLinks
}: {
  messages: ChatMessage[]
  /** 只有最后一条回答给重试入口,历史回答不翻烧饼 */
  lastAssistantKey?: string
  busy: boolean
  retryFrom: (idx: number) => void
  fileLinks?: FileLinkTarget | null
}): React.JSX.Element {
  return (
    <div className="fc-col">
      {messages.map((m, idx) => {
        if (m.role === 'note') {
          // 程序垫的灰字条:像旁边有人递了份新材料,不装成谁说的话。
          // 探针干活的步骤走时间线小样:左对齐带点,和居中的通知灰字分开
          if (m.kind === 'step') {
            return (
              <div key={m.key} className="chat-note is-step" role="status">
                <FileNoteText text={m.text} fileLinks={fileLinks} />
              </div>
            )
          }
          // 命中清单卡:搜索的完整命中程序直接摆卡,可点跳行
          if (m.kind === 'matches' && m.matches) {
            return <MatchListCard key={m.key} card={m.matches} fileLinks={fileLinks} />
          }
          // 压缩摘要卡:旧对话的提炼成果,点开看全文,不用的时候收着不占地
          if (m.kind === 'summary') {
            return (
              <details key={m.key} className="chat-note is-summary" role="status">
                <summary>旧对话已压缩成摘要(点开看)</summary>
                <p>
                  <FileNoteText text={m.text} fileLinks={fileLinks} />
                </p>
              </details>
            )
          }
          return (
            <div key={m.key} className="chat-note" role="status">
              <FileNoteText text={m.text} fileLinks={fileLinks} />
            </div>
          )
        }
        if (m.role === 'user') {
          return (
            <div key={m.key} className="message user">
              {m.text}
              {/* 这轮带的文件:文件名跟在自己话后面,回看时知道当时给模型读了什么 */}
              {m.files && m.files.length > 0 && (
                <div className="msg-files">
                  {m.files.map((f) => (
                    <span
                      key={f.id}
                      className="msg-file mono"
                      data-tip={`${f.relPath ?? f.absPath ?? f.name} · ${fileAttachRangeLabel(f)}`}
                    >
                      {f.name}
                    </span>
                  ))}
                </div>
              )}
              {/* 这轮带的图片:缩略图跟在自己话后面,回看时知道当时给模型看了什么 */}
              {m.images && m.images.length > 0 && (
                <div className="msg-imgs">
                  {m.images.map((img) => (
                    <img
                      key={img.id}
                      className="msg-img"
                      src={img.dataUrl}
                      alt={img.name}
                      data-tip={`${img.name} · ${img.width}×${img.height}`}
                    />
                  ))}
                </div>
              )}
              {/* 这轮引用过哪几段:自己发的话里留下痕迹,回看时知道当时给的是什么 */}
              {m.refs && m.refs.length > 0 && (
                <div className="msg-refs">
                  {m.refs.map((r, i) => (
                    <span
                      key={`${r.relPath}-${r.startLine}-${r.endLine}-${i}`}
                      className="msg-ref mono"
                    >
                      {r.relPath.split('/').pop()} 第 {r.startLine}-{r.endLine} 行
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        }
        return (
          // 消息级兜底网:一条回答画崩了只挂这一条,提示+就地重试;以前会掀桌炸掉整棵树
          <ErrorBoundary key={m.key} note="这条回答渲染失败，其余消息不受影响" retryLabel="重试">
            <AssistantBubble
              msg={m}
              canRetry={m.key === lastAssistantKey && !busy}
              retryIndex={idx}
              onRetry={retryFrom}
              fileLinks={fileLinks}
            />
          </ErrorBoundary>
        )
      })}
    </div>
  )
}
