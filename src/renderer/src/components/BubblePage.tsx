import { useEffect, useState } from 'react'
import { useAiChat, type ChatMessage } from '../useAiChat'
import './bubble.css'

/**
 * 气泡聊天页(?view=bubble,右键问一问):资源管理器右键文件 → 桌宠旁边弹出的
 * 聊天小窗。换皮不换脑 —— 里面就是自由聊天的后端(useAiChat → aiChat),
 * 皮换成小窗:顶栏文件名、出界文件的切根提示条、精简消息区 + 输入框。
 * 出界文件策略(已拍板):
 *  - 文件在当前项目内:agent 翻文件模式开聊(根就是当前项目);
 *  - 文件在项目外:人话提示 + 「把它的文件夹设为工作目录」按钮;不点也能聊
 *    (文件内容已当资料附上,单文件聊,agent 关),点了就地切根、问答接着走。
 */

/** 气泡窗拉到的文件档案(主进程 bubble-open 的回包) */
interface BubbleFile {
  path: string
  fileName: string
  folder: string
  inProject: boolean
  relPath: string
  rootPath: string | null
  content: string | null
  readNote?: string
}

/** 聊天的两种形态:单文件(内容当资料,agent 关)和 项目根(agent 翻文件) */
type ChatShape = { mode: 'single'; file: BubbleFile } | { mode: 'root'; file: BubbleFile; root: string }

/** 把文件档案捏成聊天资料附件:内容封顶截断的事主进程已干,这里只装车 */
function fileToContext(file: BubbleFile, relPath: string): Parameters<typeof useAiChat>[0] {
  return {
    targetType: 'file',
    name: file.fileName,
    relPath,
    summary: '资源管理器右键带来的文件',
    details: [file.content ?? '', file.readNote ?? ''].filter(Boolean).join('\n') || '(这个文件没读出内容)'
  }
}

export function BubblePage(): React.JSX.Element {
  const [file, setFile] = useState<BubbleFile | null>(null)
  const [shape, setShape] = useState<ChatShape | null>(null)
  const [draft, setDraft] = useState('')
  // 聊天记录接力棒:形态切换(单文件 → 切根)时 BubbleChat 会整块重挂,记录从这里续上
  const [history, setHistory] = useState<ChatMessage[]>([])

  // 开窗先拉右键带来的文件;气泡已开着又接到新文件时,主进程喊一声,当场换人
  useEffect(() => {
    let alive = true
    void window.atlas.bubbleOpen().then((f) => {
      if (!alive || !f) return
      setFile(f)
      setShape(f.inProject && f.rootPath ? { mode: 'root', file: f, root: f.rootPath } : { mode: 'single', file: f })
    })
    const offChanged = window.atlas.onBubbleFileChanged(() => {
      void window.atlas.bubbleOpen().then((f) => {
        if (!f) return
        setFile(f)
        setShape(f.inProject && f.rootPath ? { mode: 'root', file: f, root: f.rootPath } : { mode: 'single', file: f })
      })
    })
    return () => {
      alive = false
      offChanged()
    }
  }, [])

  if (!file || !shape) {
    return <div className="bubble-root"><div className="bubble-empty">等右键带来的文件…</div></div>
  }

  return (
    <BubbleChat
      key={`${shape.mode}:${shape.mode === 'root' ? shape.root : file.path}`}
      file={file}
      shape={shape}
      draft={draft}
      setDraft={setDraft}
      setShape={setShape}
      initialHistory={history}
      onHistoryChange={setHistory}
    />
  )
}

/** 聊天本体:key 换形态时整块重挂,记录通过 initialHistory 接力,不丢一句 */
function BubbleChat(props: {
  file: BubbleFile
  shape: ChatShape
  draft: string
  setDraft: (v: string) => void
  setShape: (s: ChatShape) => void
  initialHistory: ChatMessage[]
  onHistoryChange: (messages: ChatMessage[]) => void
}): React.JSX.Element {
  const { shape, setShape, setDraft, initialHistory, onHistoryChange } = props
  const chat = useAiChat(
    fileToContext(shape.file, shape.file.relPath || shape.file.fileName),
    shape.mode === 'root' ? shape.root : null,
    initialHistory.length > 0 ? initialHistory : undefined,
    shape.mode === 'root' ? 'always' : 'never'
  )
  // 聊天记录逐帧接力给外层:形态切换重挂时从这里续上
  useEffect(() => {
    onHistoryChange(chat.messages)
  }, [chat.messages, onHistoryChange])

  function send(text: string): void {
    chat.send(text)
    setDraft('')
  }

  return (
    <div className="bubble-root">
      <div className="bubble-card">
        <div className="bubble-head">
          <span className="bubble-title" title={shape.file.path}>
            问问小探针 · {shape.file.fileName}
          </span>
          <button type="button" className="bubble-close" onClick={() => window.close()} aria-label="关闭气泡">
            ×
          </button>
        </div>
        {shape.mode === 'single' && (
          <div className="bubble-outside">
            <span>这个文件不在我打开的项目里,先就文件本身聊;想让我翻它的邻居,点下面。</span>
            <button type="button" onClick={() => setShape({ mode: 'root', file: shape.file, root: shape.file.folder })}>
              把它的文件夹设为工作目录
            </button>
          </div>
        )}
        {shape.mode === 'root' && <div className="bubble-rootbar">工作目录:{shape.root}</div>}
        <div className="bubble-messages">
          <div className="bubble-note">已选文件:{shape.file.fileName}</div>
          {chat.messages.map((m) =>
            m.role === 'note' ? null : (
              <div key={m.key} className={`bubble-msg bubble-${m.role} is-${m.state}`}>
                {m.text}
                {m.state === 'busy' && m.text === '' && <span className="bubble-typing">小探针在想…</span>}
              </div>
            )
          )}
        </div>
        <div className="bubble-inputrow">
          <input
            value={props.draft}
            onChange={(e) => props.setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !chat.busy && props.draft.trim()) {
                e.preventDefault()
                send(props.draft)
              }
            }}
            placeholder={chat.busy ? '小探针在忙…' : '问问这个文件…'}
            disabled={chat.busy}
          />
          <button type="button" onClick={() => send(props.draft)} disabled={chat.busy || !props.draft.trim()}>
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
