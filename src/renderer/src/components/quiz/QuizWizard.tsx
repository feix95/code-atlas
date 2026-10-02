// 立项问卷向导(§3.2):每组一屏、顶部进度、条件显隐由 shared/quiz 数据层算。
// 每题带「不确定,让 AI 建议」;草稿自动落 localStorage(见 quizStore)。
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildProjectBrief } from '@shared/quiz/brief'
import { visibleGroups } from '@shared/quiz/questions'
import type { AnswerMap, QuizAnswer, QuizQuestion } from '@shared/quiz/types'
import { quizActions, useQuiz } from '../../quiz/quizStore'

/** 「让 AI 建议」的固定选项文案 */
const AI_LABEL = '不确定,让 AI 建议'

function OptionList({
  q,
  answer
}: {
  q: QuizQuestion
  answer: QuizAnswer | undefined
}): React.JSX.Element {
  const ids = answer?.kind === 'options' ? answer.ids : []
  const isAi = answer?.kind === 'ai'
  const multi = q.kind === 'multi'
  return (
    <div className="qz-opts" role={multi ? 'group' : 'radiogroup'} aria-label={q.title}>
      {q.options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`qz-opt${ids.includes(o.id) ? ' is-on' : ''}`}
          role={multi ? 'checkbox' : 'radio'}
          aria-checked={ids.includes(o.id)}
          onClick={() => quizActions.toggle(q.id, o.id, multi)}
        >
          <span className="qz-opt-mark" aria-hidden="true">
            {multi ? (ids.includes(o.id) ? '☑' : '☐') : ids.includes(o.id) ? '●' : '○'}
          </span>
          {o.label}
        </button>
      ))}
      <button
        type="button"
        className={`qz-opt qz-opt-ai${isAi ? ' is-on' : ''}`}
        aria-pressed={isAi}
        onClick={() => quizActions.aiSuggest(q.id)}
      >
        {AI_LABEL}
      </button>
      {q.id === 'G3' && ids.includes('have') && (
        <input
          className="qz-extra"
          type="text"
          placeholder="填色号,如 #3B82F6"
          aria-label="品牌主色色号"
          value={answer?.kind === 'options' ? (answer.extra ?? '') : ''}
          onChange={(e) => quizActions.setExtra(q.id, 'have', e.target.value)}
        />
      )}
    </div>
  )
}

function Question({
  q,
  answer
}: {
  q: QuizQuestion
  answer: QuizAnswer | undefined
}): React.JSX.Element {
  return (
    <div className="qz-q">
      <div className="qz-q-title">
        <span className="qz-q-id">{q.id}</span>
        {q.title}
      </div>
      {q.note && <p className="qz-note">{q.note}</p>}
      {q.kind === 'text' ? (
        <div>
          <input
            className="qz-extra"
            type="text"
            placeholder={q.placeholder ?? ''}
            aria-label={q.title}
            value={answer?.kind === 'text' ? answer.text : ''}
            onChange={(e) => quizActions.setText(q.id, e.target.value)}
          />
          <button
            type="button"
            className={`qz-opt qz-opt-ai${answer?.kind === 'ai' ? ' is-on' : ''}`}
            aria-pressed={answer?.kind === 'ai'}
            onClick={() => quizActions.aiSuggest(q.id)}
          >
            {AI_LABEL}
          </button>
        </div>
      ) : (
        <OptionList q={q} answer={answer} />
      )}
    </div>
  )
}

/** 完成页:立项单预览 + 复制;导出文件/交 agent/预填在后续子任务接进来 */
function DoneView({ answers }: { answers: AnswerMap }): React.JSX.Element {
  const brief = useMemo(() => buildProjectBrief({ answers }), [answers])
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(brief)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="qz-done">
      <h3 className="qz-done-title">立项单生成好了</h3>
      <p className="qz-hint">这份文档交给你的 AI 编程助手做技术选型;也可以复制下来贴给它。</p>
      <div className="qz-actions">
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>
          {copied ? '已复制' : '复制立项单'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={quizActions.restart}>
          重答一遍
        </button>
        <button type="button" className="btn btn-ghost" onClick={quizActions.close}>
          收工
        </button>
      </div>
      <pre className="qz-brief">{brief}</pre>
    </div>
  )
}

export function QuizWizard(): React.JSX.Element | null {
  const { open, answers, groupIndex, done } = useQuiz()
  const groups = useMemo(() => visibleGroups(answers), [answers])
  // 答题会改变可见组数;组下标越界时钳到末组
  const clamped = Math.min(groupIndex, Math.max(0, groups.length - 1))
  const cur = groups[clamped]
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (clamped !== groupIndex) quizActions.setGroup(clamped)
  }, [clamped, groupIndex])

  // Esc 收摊(草稿已自动存,不丢进度)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') quizActions.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const goto = (index: number): void => {
    quizActions.setGroup(index)
    topRef.current?.scrollTo?.({ top: 0 })
  }

  return (
    <div className="qz-backdrop" role="dialog" aria-modal="true" aria-label="立项问卷">
      <div className="qz-sheet" ref={topRef}>
        <header className="qz-head">
          <span className="qz-title">立项问卷</span>
          <span className="qz-progress" aria-label={`第 ${clamped + 1} 组,共 ${groups.length} 组`}>
            {done ? '完成' : `第 ${clamped + 1} / ${groups.length} 组`}
          </span>
          <div className="qz-head-btns">
            <button type="button" className="btn btn-ghost" onClick={quizActions.close}>
              {done ? '关闭' : '先放着,草稿自动存'}
            </button>
          </div>
        </header>
        <div className="qz-bar" aria-hidden="true">
          <div
            className="qz-bar-fill"
            style={{ width: `${(done ? 1 : groups.length ? clamped / groups.length : 0) * 100}%` }}
          />
        </div>
        {done || !cur ? (
          <DoneView answers={answers} />
        ) : (
          <>
            <h3 className="qz-group-title">
              {cur.group.id} 组 · {cur.group.title}
            </h3>
            {cur.questions.map((q) => (
              <Question key={q.id} q={q} answer={answers[q.id]} />
            ))}
            <footer className="qz-foot">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={clamped === 0}
                onClick={() => goto(clamped - 1)}
              >
                上一组
              </button>
              <span className="qz-hint">不答也行,空着的题会记进「待定项」</span>
              {clamped < groups.length - 1 ? (
                <button type="button" className="btn btn-primary" onClick={() => goto(clamped + 1)}>
                  下一组
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={quizActions.finish}>
                  生成立项单
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
