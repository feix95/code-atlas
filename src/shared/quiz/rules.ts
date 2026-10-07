// 推导规则表(第 3.4 节):答案组合 → 立项单「推导约束」文案。
// 整张表是配置:新增规则只在 QUIZ_RULES 里加一行,不动判定逻辑。

import { QUESTION_MAP } from './questions.ts'
import type { AnswerMap, QuizRule } from './types.ts'

const picked = (answers: AnswerMap, qid: string, ...ids: string[]): boolean => {
  const a = answers[qid]
  return a?.kind === 'options' && ids.some((id) => a.ids.includes(id))
}
const notPicked = (answers: AnswerMap, qid: string, ...ids: string[]): boolean => {
  const a = answers[qid]
  return a?.kind === 'options' && !ids.some((id) => a.ids.includes(id))
}

export const QUIZ_RULES: QuizRule[] = [
  {
    id: 'need-backend',
    when: (a) => picked(a, 'D2', 'sync', 'shared'),
    constraint: '需要后端或云同步服务'
  },
  {
    id: 'need-account',
    when: (a) => picked(a, 'D1', 'email', 'third-party'),
    constraint: '需要账号系统与用户数据库;需处理密码安全与找回'
  },
  {
    id: 'need-realtime',
    when: (a) => picked(a, 'D3', 'realtime'),
    constraint: '需要实时通信能力(WebSocket 类服务)'
  },
  {
    id: 'need-payment',
    when: (a) => notPicked(a, 'D4', 'free'),
    constraint: '需要支付服务与商户资质;上架应用商店的数字内容须走商店内购并被抽成'
  },
  {
    id: 'cn-filing',
    when: (a) => picked(a, 'C4', 'cn') && picked(a, 'C3', 'web', 'store'),
    constraint: '需要 ICP 备案或 APP 备案'
  },
  {
    id: 'ios-store',
    when: (a) => picked(a, 'A3', 'ios') && picked(a, 'C3', 'store'),
    constraint: '需要 Apple 开发者账号(年费)与 Mac 或云构建环境'
  },
  {
    id: 'cross-platform',
    when: (a) => picked(a, 'A1', 'desktop') && picked(a, 'A1', 'phone'),
    constraint: '优先考虑跨平台技术栈,避免两套代码'
  },
  {
    id: 'data-security',
    when: (a) => picked(a, 'E1', 'finance', 'health', 'pii'),
    constraint: '数据需加密存储与传输;需隐私政策;注意所在地区的个人信息保护法规'
  },
  {
    id: 'minor-protection',
    when: (a) => picked(a, 'E1', 'minor'),
    constraint: '需额外的未成年人保护合规'
  },
  {
    id: 'zero-budget',
    when: (a) => picked(a, 'F1', 'zero'),
    constraint: '优先本地存储或免费额度内的云服务;避免必须付费的后端'
  },
  {
    id: 'offline-first',
    when: (a) => picked(a, 'A5', 'offline'),
    constraint: '数据本地优先;所有核心功能不依赖网络'
  },
  {
    id: 'a11y-enhanced',
    when: (a) => picked(a, 'D9', 'enhanced'),
    constraint: '第二步自动开启加强版无障碍校验(更大字号下限、更高对比度要求)'
  }
]

/** 命中的规则(按表序);立项单「推导约束」节只列命中的 */
export function matchedRules(answers: AnswerMap): QuizRule[] {
  return QUIZ_RULES.filter((r) => r.when(answers))
}

/** 题面 + 答案的展示用文本;未作答返回 null。立项单答案总表用它 */
export function answerText(qid: string, answers: AnswerMap): string | null {
  const q = QUESTION_MAP[qid]
  const a = answers[qid]
  if (!q || !a) return null
  if (a.kind === 'ai') return '让 AI 建议'
  if (a.kind === 'text') return a.text.trim() || null
  const labels = a.ids.map((id) => q.options.find((o) => o.id === id)?.label ?? id)
  const base = labels.join('、')
  return a.extra?.trim() ? `${base}(${a.extra.trim()})` : base
}
