import { useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import type { ChatCodeRef } from '@shared/types'
import type { FileLinkTarget } from '@shared/fileLinks'
import type { ChatImage } from '@shared/chatImage'
import { IconRefresh } from './Icons'
import { FreeChatComposer } from './FreeChatComposer'
import { FreeChatMessages } from './FreeChatMessages'
import { REF_ONLY_QUESTION, type AiChatApi, type ChatMessage } from '../useAiChat'
import { useModelVision } from '../useModelVision'
import { useChatImages } from '../useChatImages'
import { useChatFiles } from '../useChatFiles'
import { bindChatZoomWheel, useChatZoom } from '../docZoom'
import { AiSetupContext } from '../aiSetupContext'
import { INLINE_ICON_SIZE } from '../inputMetrics'
import { useChatDrop } from '../useChatDrop'
import { useChatScroll } from '../useChatScroll'
import type { ChatFileAttachment } from '@shared/chatFiles'

/**
 * 自由对话面板(对话页改版定稿):开放式聊天,问题不限于当前文件,页签叫「自由对话」。
 * 顶行薄条:右「新对话」小幽灵钮。空场 = 衬线问候 + 居中胶囊舱 + 建议 chips;
 * 聊开了舱沉底栏,回答不装框不带头像。
 * 拆分登记:消息列表 → FreeChatMessages;胶囊舱 → FreeChatComposer;
 * 回答气泡+思考行 → FreeChatBubble;程序递话/命中卡 → FreeChatNotes。
 * 滚动账与拖入分流各在 useChatScroll / useChatDrop。
 */

const CHAT_EXAMPLES = [
  '这个项目从哪里开始看？',
  '我想找一个功能，应该看哪里？',
  '这个文件和其他部分有什么关系？'
]

export function FreeChatPanel({
  chat,
  refs,
  onRemoveRef,
  onDropRef,
  rootPath,
  fileLinks
}: {
  chat: AiChatApi
  /** 已引用的代码段:预览模式下由左栏选中攒出来 */
  refs?: ChatCodeRef[]
  onRemoveRef?: (index: number) => void
  /** 拖来的文件读盘走 rootPath:树里拖文件当附件读原文,拖图片进待发图 */
  rootPath?: string
  /** 预览里选中的一段拖进来挂引用:ref 正文自包含,不用读盘 */
  onDropRef?: (ref: ChatCodeRef) => void
  /** 文件链接(索引 + 点击去处):AI 提到对上登记的文件就变可点;不传就纯文字 */
  fileLinks?: FileLinkTarget | null
}): React.JSX.Element {
  const setup = useContext(AiSetupContext)
  const draftRefs = refs ?? []
  // 图片附件:能力账订阅 + 待发图片状态;拒收/清账的灰字走 chat.note
  const vision = useModelVision()
  const chatImages = useChatImages(vision, chat.note)
  const chatFiles = useChatFiles(chat.note)
  // 对话页字号(Ctrl+滚轮):单独一本账,只乘聊天内容的字号 token,不碰界面缩放
  const chatZoom = useChatZoom()
  const shellRef = useRef<HTMLDivElement | null>(null)
  const { scrollRef, showJump, onMessagesScroll, jumpToLatest, forceBottom } = useChatScroll(
    chat.messages,
    chatZoom
  )
  const { dragOver, onDragOver, onDragLeave, onDrop } = useChatDrop({
    rootPath,
    onDropRef,
    chat,
    chatImages,
    chatFiles
  })

  // Ctrl+滚轮挂在对话页根节点上:消息区和输入舱都算,普通滚轮不受影响
  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    return bindChatZoomWheel(el)
  }, [])

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
    // 引用/图片/文件都原样带上再问一遍
    send(
      prev.text || (prev.images?.length || prev.files?.length ? '' : REF_ONLY_QUESTION),
      prev.refs,
      prev.images,
      prev.files
    )
  }, [])

  // 重试只挂在最后一条回答上。这份账一轮渲染算一次 —— 原先写在 map 里是 O(n²)
  const lastAssistantKey = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'assistant') return chat.messages[i].key
    }
    return undefined
  }, [chat.messages])

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
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* 顶行:薄得几乎不存在 —— 只留新对话(资料跟着选中项走树里看得见) */}
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
            <FreeChatMessages
              messages={chat.messages}
              lastAssistantKey={lastAssistantKey}
              busy={chat.busy}
              retryFrom={retryFrom}
              fileLinks={fileLinks}
            />
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
