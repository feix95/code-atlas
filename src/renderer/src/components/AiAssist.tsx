import { useRef, useState, type FormEvent } from 'react'
import type { AiAssistApi, AiTurn } from '../useAiAsk'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

// 本文件只放 AI 助手的展示组件;状态机钩子在 ../useAiAsk.ts(纯函数文件,HMR 才不打架)

/** 当前最新一轮的状态;一轮都没有 = 未请求 */
function latestTurn(turns: AiTurn[]): AiTurn | null {
  return turns.length > 0 ? turns[turns.length - 1] : null
}

function stateBadge(turn: AiTurn | null): { label: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'muted' } {
  if (!turn) return { label: '尚未请求', tone: 'muted' }
  switch (turn.state) {
    case 'busy':
      return { label: '分析中', tone: 'blue' }
    case 'done':
      return { label: '已完成', tone: 'green' }
    case 'cancelled':
      return { label: '已取消', tone: 'amber' }
    case 'unsupported':
      return { label: '无需模型', tone: 'muted' }
    case 'error':
      return { label: '出错', tone: 'red' }
  }
}

/** 一轮问答的正文渲染:请求中(流式+光标)/完成/取消/失败/无需模型,五态各有各的说法 */
export function TurnText({ turn }: { turn: AiTurn }): React.JSX.Element {
  if (turn.state === 'busy') {
    return turn.text ? (
      <div className="explain-text">
        {turn.text}
        <span className="stream-caret">▌</span>
      </div>
    ) : (
      <div className="explain-note">
        <ProgressDots />
        正在把代码翻译成人话……(第一次可能慢,模型要热身)
      </div>
    )
  }
  if (turn.state === 'error') return <Notice kind="error">{turn.text}</Notice>
  if (turn.state === 'unsupported') return <Notice kind="info">{turn.text}</Notice>
  if (turn.state === 'cancelled') {
    return (
      <div className="explain-note">
        {turn.text ? (
          <>
            分析已取消,已经生成的这部分先留给你:
            <div className="explain-text">{turn.text}</div>
          </>
        ) : (
          '分析已取消。'
        )}
      </div>
    )
  }
  return <div className="explain-text">{turn.text}</div>
}

interface PresetRowProps {
  presets: string[]
  disabled: boolean
  onPick: (question: string) => void
}

/** 预设问题一排:点了就直接问,不用自己组织话 */
function PresetRow({ presets, disabled, onPick }: PresetRowProps): React.JSX.Element | null {
  if (presets.length === 0) return null
  return (
    <div className="prompt-row">
      {presets.map((q) => (
        <button key={q} type="button" className="prompt" disabled={disabled} onClick={() => onPick(q)}>
          {q}
        </button>
      ))}
    </div>
  )
}

/**
 * 概览页的 AI 紧凑卡:主按钮随状态换脸(解释/取消/重试/再来一次),
 * 结果正文直接展示;想追问去「AI 对话」Tab(共用同一份 turns)。
 */
export function AiAssistCard({
  ai,
  presets,
  idleText,
  mainLabel
}: {
  ai: AiAssistApi
  presets: string[]
  /** 未请求时的说明文案 */
  idleText: string
  /** 主按钮文案(未请求态) */
  mainLabel: string
}): React.JSX.Element {
  const turn = latestTurn(ai.turns)
  const badge = stateBadge(turn)
  return (
    <section className="ai-card">
      <div className="ai-card-head">
        <span className="ai-title">
          <span className="spark" aria-hidden="true">
            ✦
          </span>
          AI 助手
        </span>
        <span className={`badge badge-${badge.tone}`}>{badge.label}</span>
      </div>
      <div className="ai-card-body">
        {!turn && (
          <>
            <p>{idleText}</p>
            <div className="ai-card-actions">
              <button type="button" className="btn btn-primary" onClick={() => ai.ask(null)}>
                {mainLabel}
              </button>
            </div>
            <PresetRow presets={presets} disabled={false} onPick={(q) => ai.ask(q)} />
          </>
        )}
        {turn?.state === 'busy' && (
          <>
            <TurnText turn={turn} />
            <div className="ai-card-actions">
              <button type="button" className="btn" onClick={ai.cancel}>
                取消分析
              </button>
            </div>
          </>
        )}
        {turn && turn.state !== 'busy' && (
          <>
            <TurnText turn={turn} />
            <div className="ai-card-actions">
              {turn.state === 'error' || turn.state === 'cancelled' ? (
                <button type="button" className="btn btn-primary" onClick={() => ai.ask(turn.question)}>
                  {turn.state === 'error' ? '重试' : '重新分析'}
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => ai.ask(turn.question)}>
                  {turn.question ? '再问一次' : '再解释一次'}
                </button>
              )}
            </div>
            <PresetRow presets={presets} disabled={false} onPick={(q) => ai.ask(q)} />
          </>
        )}
      </div>
    </section>
  )
}

/**
 * AI 对话 Tab:所有问答摆成一条线(问的靠右蓝泡,答的靠左白泡)。
 * 推荐追问按钮点一下只是填进输入框,方便改两个字再发;回车照常发送。
 * 文件和文件夹都有输入框 —— "这个能删吗"这种追问就是给文件夹准备的。
 */
export function AiChatPanel({
  ai,
  presets,
  contextLabel,
  mainLabel,
  folderMode = false
}: {
  ai: AiAssistApi
  presets: string[]
  contextLabel: string
  mainLabel: string
  folderMode?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function fill(q: string): void {
    setDraft(q)
    inputRef.current?.focus()
  }

  function submit(e: FormEvent): void {
    e.preventDefault()
    const q = draft.trim()
    if (!q || ai.busy) return
    ai.ask(q)
    setDraft('')
  }

  return (
    <div className="chat-shell">
      {ai.turns.length === 0 && (
        <div className="chat-intro">
          <p>
            围绕 <strong>{contextLabel}</strong> 追问:挑一个推荐问题填进去(可以改两个字再发),或自己输入。
            AI 会带着前面讲解的内容一起回答,不会每次都从头来。
          </p>
          {folderMode && (
            <div className="ai-card-actions">
              <button type="button" className="btn btn-primary" onClick={() => ai.ask(null)}>
                {mainLabel}
              </button>
            </div>
          )}
        </div>
      )}
      {ai.turns.length > 0 && (
        <div className="chat-messages">
          {ai.turns.map((turn) => (
            <div key={turn.key} className="chat-turn">
              <div className={`message${turn.question ? ' user' : ''}`}>{turn.question ?? `(${mainLabel})`}</div>
              <div className="message answer">
                {turn.state === 'busy' || turn.state === 'error' || turn.state === 'unsupported' ? (
                  <TurnText turn={turn} />
                ) : turn.state === 'cancelled' ? (
                  <>
                    分析已取消。
                    {turn.text && <div className="explain-text">{turn.text}</div>}
                  </>
                ) : (
                  turn.text || '(没有内容)'
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="chat-bottom">
        <PresetRow presets={presets} disabled={false} onPick={fill} />
        <form className="chat-input" onSubmit={submit}>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder={ai.busy ? 'AI 正在回答上一个问题……' : `追问 ${contextLabel}……`}
            aria-label="输入追问"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={ai.busy}>
            {ai.busy ? '回答中……' : '发送'}
          </button>
          {ai.busy && (
            <button type="button" className="btn btn-ghost" onClick={ai.cancel}>
              取消分析
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
