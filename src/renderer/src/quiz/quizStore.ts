// 立项问卷界面账:答案 + 当前组序号 + 完成态;草稿自动落 localStorage,中途关掉可接着答(第 3.2 节)。
// 纯界面态放这;题目/规则/立项单逻辑全在 shared/quiz/ 的数据层。
import { useSyncExternalStore } from 'react'
import type { AnswerMap, QuizAnswer } from '@shared/quiz/types'

const DRAFT_KEY = 'atlas.quizDraft.v1'

interface QuizState {
  /** 问卷浮层开关(起步页与向导共用入口) */
  open: boolean
  answers: AnswerMap
  /** 当前在第几组(下标对应当前可见组;答题致组数变化时由界面层钳位) */
  groupIndex: number
  /** 是否走完最后一组,落到完成页 */
  done: boolean
  /** 技术栈回填(第 3.6 节):预设清单选的或粘贴的 agent 结论;预填第二步时作默认导出目标 */
  techStack: string
  /** 产品名(第 3.5 节 基本信息,可空):进立项单,也当预填方案的默认名 */
  productName: string
}

function loadDraft(): {
  answers: AnswerMap
  done: boolean
  techStack: string
  productName: string
} {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return { answers: {}, done: false, techStack: '', productName: '' }
    const parsed = JSON.parse(raw) as {
      answers?: AnswerMap
      done?: boolean
      techStack?: string
      productName?: string
    }
    return {
      answers: parsed.answers ?? {},
      done: parsed.done === true,
      techStack: typeof parsed.techStack === 'string' ? parsed.techStack : '',
      productName: typeof parsed.productName === 'string' ? parsed.productName : ''
    }
  } catch {
    return { answers: {}, done: false, techStack: '', productName: '' }
  }
}

const draft = loadDraft()
let state: QuizState = {
  open: false,
  answers: draft.answers,
  groupIndex: 0,
  done: draft.done,
  techStack: draft.techStack,
  productName: draft.productName
}
const listeners = new Set<() => void>()

function persist(): void {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        answers: state.answers,
        done: state.done,
        techStack: state.techStack,
        productName: state.productName
      })
    )
  } catch {
    // 存储满了/私密模式:草稿丢就丢,不挡答题
  }
}

function emit(patch: Partial<QuizState>): void {
  state = { ...state, ...patch }
  persist()
  for (const l of listeners) l()
}

export const quizActions = {
  open(): void {
    emit({ open: true, done: state.done })
  },
  close(): void {
    emit({ open: false })
  },
  answer(qid: string, answer: QuizAnswer): void {
    emit({ answers: { ...state.answers, [qid]: answer } })
  },
  /** 切换选项类答案;多选做增删,单选做替换(重选同项=取消) */
  toggle(qid: string, optionId: string, multi: boolean): void {
    const cur = state.answers[qid]
    const curIds = cur?.kind === 'options' ? cur.ids : []
    const ids = multi
      ? curIds.includes(optionId)
        ? curIds.filter((i) => i !== optionId)
        : [...curIds, optionId]
      : curIds.length === 1 && curIds[0] === optionId
        ? []
        : [optionId]
    emit({ answers: { ...state.answers, [qid]: { kind: 'options', ids } } })
  },
  setText(qid: string, text: string): void {
    emit({ answers: { ...state.answers, [qid]: { kind: 'text', text } } })
  },
  /** G3「已有(填色号)」这类带补充输入的单选 */
  setExtra(qid: string, optionId: string, extra: string): void {
    emit({ answers: { ...state.answers, [qid]: { kind: 'options', ids: [optionId], extra } } })
  },
  aiSuggest(qid: string): void {
    emit({ answers: { ...state.answers, [qid]: { kind: 'ai' } } })
  },
  setGroup(index: number): void {
    emit({ groupIndex: index })
  },
  finish(): void {
    emit({ done: true })
  },
  setTechStack(text: string): void {
    emit({ techStack: text })
  },
  setProductName(text: string): void {
    emit({ productName: text })
  },
  /** 重答:清答案回第一组(草稿一并清);技术栈回填保留,它跟答案无关 */
  restart(): void {
    emit({ answers: {}, groupIndex: 0, done: false })
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useQuiz(): QuizState {
  return useSyncExternalStore(subscribe, () => state)
}
