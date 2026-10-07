// 立项问卷向导(第 3.2 节):每组一屏、顶部进度、条件显隐由 shared/quiz 数据层算。
// 每题带「不确定,让 AI 建议」;草稿自动落 localStorage(见 quizStore)。
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildProjectBrief } from '@shared/quiz/brief'
import { quizPrefill } from '@shared/quiz/prefill'
import { visibleGroups } from '@shared/quiz/questions'
import { TECH_STACK_PRESETS } from '@shared/quiz/stacks'
import type { AnswerMap, QuizAnswer, QuizQuestion } from '@shared/quiz/types'
import { requestQuizAgent } from '../../quiz/quizBridge'
import { quizActions, useQuiz } from '../../quiz/quizStore'
import { schemeActions } from '../../uiFrame/schemeStore'

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

/** 完成页(第 3.5 节/第 3.6 节):立项单预览 + 三个出口(复制/存 .md/交内置 agent)+ 技术栈回填 */
function DoneView({ answers }: { answers: AnswerMap }): React.JSX.Element {
  const { techStack, productName } = useQuiz()
  const brief = useMemo(() => buildProjectBrief({ answers, productName }), [answers, productName])
  const [copied, setCopied] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(brief)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  const save = async (): Promise<void> => {
    const res = await window.atlas.quizBriefSave('', brief)
    if (res.status === 'done') setSavedPath(res.path)
  }
  const toAgent = (): void => {
    requestQuizAgent(brief)
    quizActions.close()
  }
  // 入口 A → 第二步:带着答案直接起方案(平台/风格/密度/主色/D9 加强档由问卷定)
  const toBench = (): void => {
    const prefill = quizPrefill(answers)
    schemeActions.startFromQuiz(prefill, { productName, techStack })
    schemeActions.flash(
      prefill.templateId
        ? '已按问卷预填:平台、风格、密度与主色都铺好了'
        : '已按问卷预填平台与密度;所选风格暂未内置,从空白起步'
    )
    quizActions.close()
  }
  return (
    <div className="qz-done">
      <h3 className="qz-done-title">立项单生成好了</h3>
      <p className="qz-hint">
        这份文档交给你的 AI 编程助手做技术选型;可以复制下来贴给它,或存成 .md 文件带走。
      </p>
      <div className="qz-backfill-row">
        <input
          className="qz-extra qz-stack-input"
          type="text"
          placeholder="产品名(可空,会进立项单和方案名)"
          aria-label="产品名"
          value={productName}
          onChange={(e) => quizActions.setProductName(e.target.value)}
        />
      </div>
      <div className="qz-actions">
        <button type="button" className="btn btn-primary" onClick={toBench}>
          带着答案调 UI
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>
          {copied ? '已复制' : '复制立项单'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void save()}>
          存成 .md 文件
        </button>
        <button type="button" className="btn btn-ghost" onClick={toAgent}>
          交给内置 agent
        </button>
        <button type="button" className="btn btn-ghost" onClick={quizActions.restart}>
          重答一遍
        </button>
        <button type="button" className="btn btn-ghost" onClick={quizActions.close}>
          收工
        </button>
      </div>
      {savedPath && <p className="qz-hint">已存到:{savedPath}</p>}
      <p className="qz-hint">
        内置的是本机小模型,技术选型质量有限;在设置里接入 LM Studio 的大模型或在线服务商,效果更好。
      </p>
      <div className="qz-backfill">
        <div className="qz-q-title">技术选型结果回填(可选)</div>
        <p className="qz-hint">
          agent 给了结论后,从清单里选或直接粘贴回来——它会作为第二步导出时的默认目标技术栈。
        </p>
        <div className="qz-backfill-row">
          <select
            className="uf-select"
            aria-label="技术栈预设"
            value=""
            onChange={(e) => {
              if (e.target.value) quizActions.setTechStack(e.target.value)
              e.target.value = ''
            }}
          >
            <option value="">从预设清单选……</option>
            {TECH_STACK_PRESETS.map((g) => (
              <optgroup key={g.platform} label={g.platform}>
                {g.stacks.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <input
            className="qz-extra qz-stack-input"
            type="text"
            placeholder="或粘贴 agent 的结论,如 Tauri + Vue"
            aria-label="技术栈结论"
            value={techStack}
            onChange={(e) => quizActions.setTechStack(e.target.value)}
          />
        </div>
        {techStack.trim() !== '' && (
          <p className="qz-hint">
            已记:<strong>{techStack}</strong>
          </p>
        )}
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
