import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatCodeRef } from '@shared/types'
import type { FileLinkTarget } from '@shared/fileLinks'
import { isImageFile } from '@shared/fileKinds'
import {
  DRAG_MIME_NODE,
  DRAG_MIME_REF,
  type DragNodePayload,
  type DragRefPayload
} from '@shared/dragTypes'
import { ErrorBoundary } from './ErrorBoundary'
import { IconRefresh } from './Icons'
import { FreeChatComposer } from './FreeChatComposer'
import { AssistantBubble } from './FreeChatBubble'
import { FileNoteText, MatchListCard } from './FreeChatNotes'
import { REF_ONLY_QUESTION, type AiChatApi, type ChatMessage } from '../useAiChat'
import type { ChatImage } from '@shared/chatImage'
import { useModelVision } from '../useModelVision'
import { useChatImages } from '../useChatImages'
import { partitionAttachFiles, useChatFiles } from '../useChatFiles'
import { bindChatZoomWheel, useChatZoom } from '../docZoom'
import { AiSetupContext } from '../aiSetupContext'
import { INLINE_ICON_SIZE } from '../inputMetrics'
import { fileAttachRangeLabel } from '@shared/chatFiles'
import type { ChatFileAttachment } from '@shared/chatFiles'

/**
 * 自由对话面板(对话页改版定稿):开放式聊天,问题不限于当前文件,页签叫「自由对话」。
 * 顶行薄条:右「新对话」小幽灵钮(参考资料 chip 已摘——资料跟着选中项走,树里看得见,
 * 不再单独立牌;附件照旧随每轮请求喂给模型,只是不再报幕)。
 * 空场 = 衬线问候 + 居中胶囊舱 + 建议 chips;聊开了舱沉底栏,回答不装框不带头像。
 * 输入舱 = 一行胶囊:「+」能力菜单(添加附件/思考/翻文件/联网)| 内嵌文件/引用原子+文字 | 发送/停一停圆钮。
 * 思考行 = 脑图标 + 流光「正在思考」+弹跳点,想完收成「想了 Xs ▸」可点开看过程。
 * 本轮动过联网就在消息下方挂程序记账的状态标签。
 * 示例问题点了直接发(和手动输入同一条路),不是仅有的问法。
 * 第一百一十一批:预览模式下左栏选中的代码以引用原子躺在舱内文字流里,和问题一起发出去。
 * 拆分登记:胶囊舱 → FreeChatComposer;回答气泡+思考行 → FreeChatBubble;
 * 程序递话/命中卡 → FreeChatNotes(纯迁移不改行为)。
 */

const CHAT_EXAMPLES = [
  '这个项目从哪里开始看？',
  '我想找一个功能，应该看哪里？',
  '这个文件和其他部分有什么关系？'
]

/**
 * 聊天面板的滚动记忆(按对话指纹记名):点聊天里的绿字跳预览时,聊天面板会从另一个
 * 条件分支整个重挂(文件夹聊天/文件聊天/预览三处分身),粘底开关一重置,面板就被
 * 压到最底,用户正看着的那条直接滚出视野。按「首尾消息指纹」记一份滚动位置:
 * 同一场对话重挂就回到原地;真新对话(指纹对不上)才滚到最新。
 */
interface ChatScrollMemory {
  fingerprint: string
  top: number
  atBottom: boolean
}
let chatScrollMemory: ChatScrollMemory | null = null

function messagesFingerprint(messages: ChatMessage[]): string {
  const first = messages[0]?.key ?? ''
  const last = messages[messages.length - 1]?.key ?? ''
  return `${messages.length}:${first}:${last}`
}

export function FreeChatPanel({
  chat,
  refs,
  onRemoveRef,
  onDropRef,
  rootPath,
  fileLinks
}: {
  chat: AiChatApi
  /** 已引用的代码段(第一百一十一批):预览模式下由左栏选中攒出来 */
  refs?: ChatCodeRef[]
  onRemoveRef?: (index: number) => void
  /** 拖来的文件读盘走 rootPath(文件附件批次):树里拖文件当附件读原文,拖图片进待发图 */
  rootPath?: string
  /** 预览里选中的一段拖进来挂引用(选中直拖批次):ref 正文自包含,不用读盘 */
  onDropRef?: (ref: ChatCodeRef) => void
  /** 文件链接(索引 + 点击去处):AI 提到对上登记的文件就变可点,点了左边开预览;不传就纯文字 */
  fileLinks?: FileLinkTarget | null
}): React.JSX.Element {
  const setup = useContext(AiSetupContext)
  const draftRefs = refs ?? []
  // 图片附件(第一百五十二批):能力账订阅 + 待发图片状态;拒收/清账的灰字走 chat.note
  const vision = useModelVision()
  const chatImages = useChatImages(vision, chat.note)
  const chatFiles = useChatFiles(chat.note)
  // 对话页字号(Ctrl+滚轮):单独一本账,只乘聊天内容的字号 token,不碰界面缩放
  const chatZoom = useChatZoom()
  const shellRef = useRef<HTMLDivElement | null>(null)
  // 拖拽悬停的亮框提示:松手就挂上,不用文案教
  const [dragOver, setDragOver] = useState(false)
  // 粘底跟滚(第六十一批):消息区自己滚;贴着底部看就跟滚,上翻过就不抢滚动条,浮出箭头报个位。
  // 箭头浮出时轻弹一次报信;流式期间保持安静 —— 逐段重放弹跳动画会变成高频闪动(小葵案)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  // Ctrl+滚轮挂在对话页根节点上:消息区和输入舱都算,普通滚轮不受影响
  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    return bindChatZoomWheel(el)
  }, [])

  function onMessagesScroll(): void {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
    atBottomRef.current = nearBottom
    setShowJump(!nearBottom)
    chatScrollMemory = {
      fingerprint: messagesFingerprint(chat.messages),
      top: el.scrollTop,
      atBottom: nearBottom
    }
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

  // 重试回调的稳定三件套(隐身案本批):消息列表、发话器、回底函数每轮渲染都是新身份,
  // 直接进闭包的话,每条气泡拿到的 onRetry 都不一样,刚上的 memo 当场破功 —— 请进 ref,
  // retryFrom 从此一个身份用到底。
  const retryCtxRef = useRef({ messages: chat.messages, send: chat.send, forceBottom })
  useEffect(() => {
    retryCtxRef.current = {
      messages: chat.messages,
      forceBottom,
      send: (
        text: string,
        sendRefs?: ChatCodeRef[],
        sendImages?: ChatImage[],
        sendFiles?: ChatFileAttachment[]
      ) => {
        if (setup && setup.configured !== true) {
          if (setup.configured === false) setup.openSettings()
          return
        }
        chat.send(text, sendRefs, sendImages, sendFiles)
      }
    }
  })
  const retryFrom = useCallback((idx: number): void => {
    const { messages, send, forceBottom: fb } = retryCtxRef.current
    // 重答的应该是最新这个问题:从这条回答往前找最近的用户提问
    let prev: ChatMessage | undefined
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        prev = messages[i]
        break
      }
    }
    if (!prev) return
    fb()
    // 重答的应该是最新这个问题:引用/图片/文件都原样带上再问一遍
    send(
      prev.text || (prev.images?.length || prev.files?.length ? '' : REF_ONLY_QUESTION),
      prev.refs,
      prev.images,
      prev.files
    )
  }, [])

  // 重试只挂在最后一条回答上,历史回答不翻烧饼。这份账一轮渲染算一次 —— 原先写在
  // map 里,每条消息都把整个数组复制一遍倒着找,消息一多、流式一刷就是 O(n²),
  // 聊久了主线程越扛越沉(外援指认的沉疴,本批拆掉)
  const lastAssistantKey = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'assistant') return chat.messages[i].key
    }
    return undefined
  }, [chat.messages])

  // 流式增量每补一段,消息数组就换一次新引用;粘着底部就压到底,不在底就什么都不做 ——
  // 原先这里会让箭头 key 变一变、蹦一下报信,但流式下每段增量都触发重挂,0.45s 弹跳动画
  // 被每秒打断几十次重放,成了高频闪动(小葵案);报信的活儿改由浮出那一次轻弹承担。
  // 面板挂载后的第一轮是「认门」:同一场对话从别的分支重挂过来(点绿字跳预览最常见),
  // 按滚动记忆回到用户刚才的位置;真新对话(指纹对不上)才滚到最新
  const restoredRef = useRef(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (!restoredRef.current) {
      restoredRef.current = true
      const fp = messagesFingerprint(chat.messages)
      const saved = chatScrollMemory?.fingerprint === fp ? chatScrollMemory : null
      atBottomRef.current = saved ? saved.atBottom : true
      // 位置一设,scroll 事件会自己来报信,贴底箭头交给 onMessagesScroll 接管
      el.scrollTop = saved && !saved.atBottom ? saved.top : el.scrollHeight
      chatScrollMemory = { fingerprint: fp, top: el.scrollTop, atBottom: atBottomRef.current }
      return
    }
    if (atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [chat.messages])

  // 换档后原本贴着底部就继续贴底:字号放大把行程拉长,scrollTop 留在原处会看着「浮上去」
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [chatZoom])

  /** 示例问题点了直接发,跟输入框发送走同一条流程;常驻的引用/文件跟着一起带;小探针忙着回上一题就不接 */
  function sendExample(q: string): void {
    if (chat.busy) return
    if (setup && setup.configured !== true) {
      if (setup.configured === false) setup.openSettings()
      return
    }
    forceBottom()
    chat.send(q, draftRefs, undefined, chatFiles.files)
  }

  /** 开场示例 chips:只在一条消息都还没有时挂着;聊起来就关闭,不再推荐 */
  const chipList = chat.messages.length === 0 ? CHAT_EXAMPLES : []

  const composerEl = (
    <FreeChatComposer
      chat={chat}
      refs={draftRefs}
      onRemoveRef={onRemoveRef}
      chatImages={chatImages}
      chatFiles={chatFiles}
      onWillSend={forceBottom}
    />
  )

  return (
    <div
      ref={shellRef}
      className={`chat-shell free-chat${dragOver ? ' is-dragover' : ''}`}
      style={{ '--fc-zoom': chatZoom } as React.CSSProperties}
      onDragOver={(e) => {
        const types = e.dataTransfer.types
        // 三种货都接:内里的引用/文件节点照旧,系统拖来的文件(Files)是附件那条路
        const accept =
          (rootPath !== undefined && types.includes(DRAG_MIME_NODE)) ||
          (onDropRef !== undefined && types.includes(DRAG_MIME_REF)) ||
          types.includes('Files')
        if (!accept) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDragOver(false)
      }}
      onDrop={(e) => {
        setDragOver(false)
        // 先认选段(自带正文):预览里选中一段拖过来的,直接挂引用不用读盘
        const rawRef = e.dataTransfer.getData(DRAG_MIME_REF)
        if (rawRef && onDropRef) {
          e.preventDefault()
          try {
            const ref = JSON.parse(rawRef) as DragRefPayload
            if (ref.relPath && ref.code) onDropRef(ref)
          } catch {
            // 不是咱家的货,不接
          }
          return
        }
        const raw = e.dataTransfer.getData(DRAG_MIME_NODE)
        if (raw && rootPath !== undefined) {
          e.preventDefault()
          try {
            const node = JSON.parse(raw) as DragNodePayload
            if (node.kind === 'folder') {
              chat.note('文件夹带不进来——点开它,把里面的文件拖进来就行')
              return
            }
            if (!node.relPath) return
            const name = node.relPath.split('/').pop() ?? node.relPath
            // 拖拽分流(文件附件批次,对齐 Claude Code 的 @文件):图片走图片链;
            // 其余文本文件当文件附件读原文(读不了的由状态表自己垫灰字)
            if (isImageFile(name)) void chatImages.addFromRelPath(rootPath, node.relPath)
            else void chatFiles.addFromRelPath(rootPath, node.relPath)
          } catch {
            // 不是咱家的货,不接
          }
          return
        }
        // 系统拖来的文件:按类分流 —— 图片进待发图,其余当文件附件读原文(两把尺各自收编)
        const dropped = Array.from(e.dataTransfer.files ?? [])
        if (dropped.length > 0) {
          e.preventDefault()
          const parts = partitionAttachFiles(dropped)
          if (parts.images.length > 0) void chatImages.addFiles(parts.images)
          if (parts.files.length > 0) void chatFiles.addFiles(parts.files)
        }
      }}
    >
      {/* 顶行:薄得几乎不存在 —— 只留新对话(参考 chip 摘了,资料跟着选中项走树里看得见) */}
      <div className="fc-topline">
        <button
          type="button"
          className="fc-newchat"
          onClick={chat.newChat}
          data-tip="清空当前对话记录,无法找回"
        >
          <IconRefresh size={INLINE_ICON_SIZE} />
          新对话
        </button>
      </div>
      <div className="chat-messages-wrap">
        <div className="chat-messages" ref={scrollRef} onScroll={onMessagesScroll}>
          {chat.messages.length === 0 ? (
            /* 空场:衬线大问候 + 舱居中当主角 + 建议 chips(Claude 首页式) */
            <div className="fc-hero">
              <h1 className="fc-hello">想聊点什么？</h1>
              {composerEl}
              {chipList.length > 0 && (
                <div className="fc-chips">
                  {chipList.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="fc-chip"
                      onClick={() => sendExample(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="fc-col">
              {chat.messages.map((m, idx) => {
                if (m.role === 'note') {
                  // 程序垫的灰字条(第一百二十四批):像旁边有人递了份新材料,不装成谁说的话。
                  // 探针干活的步骤(第一百四十一批)走时间线小样:左对齐带点,和居中的通知灰字分开
                  if (m.kind === 'step') {
                    return (
                      <div key={m.key} className="chat-note is-step" role="status">
                        <FileNoteText text={m.text} fileLinks={fileLinks} />
                      </div>
                    )
                  }
                  // 命中清单卡(LLM 优化批次):搜索的完整命中程序直接摆卡,可点跳行
                  if (m.kind === 'matches' && m.matches) {
                    return <MatchListCard key={m.key} card={m.matches} fileLinks={fileLinks} />
                  }
                  // 压缩摘要卡(第一百四十二批):旧对话的提炼成果,点开看全文,不用的时候收着不占地
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
                  // 消息级兜底网(2026-09-13 隐身案):一条回答画崩了只挂这一条,
                  // 提示+就地重试;以前会掀桌炸掉整棵树,窗直接隐身
                  <ErrorBoundary
                    key={m.key}
                    note="这条回答画不出来(程序出了个小岔子),其余消息不受影响。"
                    retryLabel="再试一次"
                  >
                    <AssistantBubble
                      msg={m}
                      canRetry={m.key === lastAssistantKey && !chat.busy}
                      retryIndex={idx}
                      onRetry={retryFrom}
                      fileLinks={fileLinks}
                    />
                  </ErrorBoundary>
                )
              })}
            </div>
          )}
        </div>
        {showJump && (
          <button
            type="button"
            className="chat-jump"
            onClick={jumpToLatest}
            aria-label="跳到最新消息"
            data-tip="跳到最新消息"
          >
            <i aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="chat-bottom">
        {setup && setup.configured !== true && (
          <p className="chat-setup-hint" role="status">
            {setup.configured === null
              ? '正在读取 AI 设置…'
              : '想用对话,需要先选择一个本地模型。项目地图和文件阅读不受影响。'}
            {setup.configured === false && (
              <button type="button" className="btn" onClick={setup.openSettings}>
                设置 AI
              </button>
            )}
          </p>
        )}
        {chat.messages.length > 0 && composerEl}
        <p className="fc-tip">
          回车发送 · Shift+回车换行
          {onDropRef || rootPath ? ' · 拖文件进来读原文,选中的代码挂引用,图片进待发区' : ''}
        </p>
      </div>
    </div>
  )
}
