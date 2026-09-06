import type { AiAssistApi, AiTurn } from '../useAiAsk'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

// 本文件只放 AI 解释的展示组件;状态机钩子在 ../useAiAsk.ts(纯函数文件,HMR 才不打架)
// 自由聊天不在这里 —— 它有自己的 FreeChatPanel 和 useAiChat,两条通道互不掺和

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
 * 结果正文直接展示。想开放式聊天去「自由对话」Tab —— 那边是独立通道,两边互不打架。
 */
export function AiAssistCard({
  ai,
  presets,
  idleText,
  mainLabel,
  onGoChat
}: {
  ai: AiAssistApi
  presets: string[]
  /** 未请求时的说明文案 */
  idleText: string
  /** 主按钮文案(未请求态) */
  mainLabel: string
  /** 给了就显示「去追问」:直接跳到自由对话 Tab,当前文件的上下文那边本来就带着 */
  onGoChat?: () => void
}): React.JSX.Element {
  const turn = latestTurn(ai.turns)
  const badge = stateBadge(turn)
  const goChat = onGoChat ? (
    <button type="button" className="btn" onClick={onGoChat}>
      去追问
    </button>
  ) : null
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
              {goChat}
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
              {goChat}
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
              {goChat}
            </div>
            <PresetRow presets={presets} disabled={false} onPick={(q) => ai.ask(q)} />
          </>
        )}
      </div>
    </section>
  )
}
