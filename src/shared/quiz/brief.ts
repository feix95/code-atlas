// 《立项单.md》生成器(§3.5):纯函数,答案 → 可交给任何 agent 的立项文档。
// 结构固定五节:基本信息 / 答案总表 / 推导约束 / 给 agent 的任务说明 / 待定项清单。

import { QUIZ_GROUPS, visibleQuestions } from './questions.ts'
import { answerText, matchedRules } from './rules.ts'
import type { BriefInput } from './types.ts'

const today = (): string => new Date().toISOString().slice(0, 10)

/** 答案总表里 ai 建议题单列;visibleQuestions 保证隐藏的题不进表 */
function answerTable(input: BriefInput): { rows: string[]; aiItems: string[] } {
  const rows: string[] = []
  const aiItems: string[] = []
  for (const group of QUIZ_GROUPS) {
    const questions = visibleQuestions(input.answers).filter((q) => q.group === group.id)
    if (questions.length === 0) continue
    rows.push(`### ${group.id} 组 · ${group.title}`, '')
    for (const q of questions) {
      const text = answerText(q.id, input.answers)
      if (text === '让 AI 建议') {
        aiItems.push(`${q.id} ${q.title}`)
        rows.push(`- ${q.id} ${q.title}:让 AI 建议`)
      } else {
        rows.push(`- ${q.id} ${q.title}:${text ?? '未作答'}`)
      }
    }
    rows.push('')
  }
  return { rows, aiItems }
}

/** 给 agent 的固定任务说明(§3.5 第 4 节) */
const AGENT_TASK = `基于以上条件,给出 2~3 套技术选型方案的对比表(技术栈、优缺点、成本、学习难度、风险)与推荐,并对「待 AI 建议项」逐条给出建议。`

export function buildProjectBrief(input: BriefInput): string {
  const { rows, aiItems } = answerTable(input)
  const rules = matchedRules(input.answers)
  const description = answerText('B2', input.answers)
  const pending = visibleQuestions(input.answers)
    .filter((q) => !input.answers[q.id])
    .map((q) => `${q.id} ${q.title}`)

  const out: string[] = [
    '# 立项单',
    '',
    '## 基本信息',
    '',
    `- 产品名:${input.productName?.trim() || '(未命名)'}`,
    `- 一句话描述:${description ?? '(未填)'}`,
    `- 填写日期:${input.date ?? today()}`,
    '',
    '## 答案总表',
    '',
    ...rows,
    '## 推导约束',
    '',
    ...(rules.length ? rules.map((r) => `- ${r.constraint}`) : ['- (无命中项)']),
    '',
    '## 给 agent 的任务说明',
    '',
    AGENT_TASK,
    ''
  ]
  if (aiItems.length) {
    out.push('### 待 AI 建议项', '', ...aiItems.map((s) => `- ${s}`), '')
  }
  out.push('## 待定项清单', '')
  out.push(...(pending.length ? pending.map((s) => `- ${s}(未作答)`) : ['- (无)']))
  out.push('')
  return out.join('\n')
}
