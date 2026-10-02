// 立项问卷(M2-a)数据层自测:纯 node 直跑。
// 覆盖:§3.2 条件显隐、§3.4 推导规则、§3.5 立项单结构、§3.6/G 组答案预填第二步。
import assert from 'node:assert/strict'
import {
  QUESTIONS,
  optionLabel,
  visibleGroups,
  visibleQuestions
} from '../src/shared/quiz/questions.ts'
import { answerText, matchedRules, QUIZ_RULES } from '../src/shared/quiz/rules.ts'
import { buildProjectBrief } from '../src/shared/quiz/brief.ts'
import { quizPrefill } from '../src/shared/quiz/prefill.ts'
import { TECH_STACK_PRESETS } from '../src/shared/quiz/stacks.ts'
import type { AnswerMap } from '../src/shared/quiz/types.ts'

const choice = (...ids: string[]) => ({ kind: 'options' as const, ids })
const ai = { kind: 'ai' as const }

// ── 题目表完整性:§3.3 的 23 道题、七组全在 ──
assert.equal(QUESTIONS.length, 29, '题库应为 §3.3 的 29 道题')
assert.deepEqual(
  [...new Set(QUESTIONS.map((q) => q.group))],
  ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  '分组应为 A~G 七组且按序'
)

// ── 条件显隐(§3.2)──
{
  const none: AnswerMap = {}
  const ids = visibleQuestions(none).map((q) => q.id)
  assert.ok(
    !ids.includes('A2') && !ids.includes('A3') && !ids.includes('A4'),
    '未选平台时系统题不显示'
  )
}
{
  const desktopOnly: AnswerMap = { A1: choice('desktop') }
  const ids = visibleQuestions(desktopOnly).map((q) => q.id)
  assert.ok(ids.includes('A2') && !ids.includes('A3'), '纯电脑端只出 A2')
}
{
  const all: AnswerMap = { A1: choice('desktop', 'phone', 'web') }
  const ids = visibleQuestions(all).map((q) => q.id)
  assert.ok(ids.includes('A2') && ids.includes('A3') && ids.includes('A4'), '选手机后系统题出现')
  const groups = visibleGroups(all).map((g) => g.group.id)
  assert.deepEqual(groups, ['A', 'B', 'C', 'D', 'E', 'F', 'G'])
}

// ── 答案文本(answerText/optionLabel)──
{
  const a: AnswerMap = {
    A1: { kind: 'options', ids: ['desktop', 'phone'] },
    B2: { kind: 'text', text: '帮健身新手记录训练' },
    G1: ai,
    G3: { kind: 'options', ids: ['have'], extra: '#FF8800' }
  }
  assert.equal(answerText('A1', a), '电脑桌面应用、手机 app')
  assert.equal(answerText('B2', a), '帮健身新手记录训练')
  assert.equal(answerText('G1', a), '让 AI 建议')
  assert.equal(answerText('G3', a), '已有(下面填色号)(#FF8800)')
  assert.equal(answerText('D1', a), null, '未作答为 null')
  assert.equal(optionLabel('A5', 'offline'), '必须能完全离线')
}

// ── 推导规则(§3.4)──
{
  const has = (a: AnswerMap, id: string) => matchedRules(a).some((r) => r.id === id)
  assert.equal(has({ D2: choice('sync') }, 'need-backend'), true)
  assert.equal(has({ D2: choice('local') }, 'need-backend'), false)
  assert.equal(has({ D1: choice('email') }, 'need-account'), true)
  assert.equal(has({ D1: choice('none') }, 'need-account'), false)
  assert.equal(has({ D3: choice('realtime') }, 'need-realtime'), true)
  assert.equal(has({ D4: choice('paid') }, 'need-payment'), true)
  assert.equal(has({ D4: choice('free') }, 'need-payment'), false)
  assert.equal(has({ C4: choice('cn'), C3: choice('store') }, 'cn-filing'), true)
  assert.equal(has({ C4: choice('cn'), C3: choice('self') }, 'cn-filing'), false)
  assert.equal(has({ A3: choice('ios'), C3: choice('store') }, 'ios-store'), true)
  assert.equal(has({ A1: choice('desktop', 'phone') }, 'cross-platform'), true)
  assert.equal(has({ E1: choice('health') }, 'data-security'), true)
  assert.equal(has({ E1: choice('minor') }, 'minor-protection'), true)
  assert.equal(has({ F1: choice('zero') }, 'zero-budget'), true)
  assert.equal(has({ A5: choice('offline') }, 'offline-first'), true)
  assert.equal(has({ D9: choice('enhanced') }, 'a11y-enhanced'), true)
  assert.equal(QUIZ_RULES.length, 12, '§3.4 首批 12 条规则')
}

// ── 立项单(§3.5 五节结构)──
{
  const answers: AnswerMap = {
    A1: choice('desktop', 'phone'),
    A2: choice('win'),
    A3: choice('android'),
    B1: choice('health'),
    B2: { kind: 'text', text: '力量训练计时器' },
    D2: choice('sync'),
    D9: choice('enhanced'),
    F2: ai
  }
  const md = buildProjectBrief({ answers, productName: '计时器', date: '2026-10-05' })
  for (const section of [
    '# 立项单',
    '## 基本信息',
    '## 答案总表',
    '## 推导约束',
    '## 给 agent 的任务说明',
    '## 待定项清单'
  ]) {
    assert.ok(md.includes(section), `立项单缺 ${section}`)
  }
  assert.ok(md.includes('产品名:计时器') && md.includes('填写日期:2026-10-05'))
  assert.ok(md.includes('需要后端或云同步服务'), '命中规则应进推导约束')
  assert.ok(md.includes('第二步自动开启加强版无障碍校验'), 'D9 规则应进推导约束')
  assert.ok(md.includes('待 AI 建议项') && md.includes('F2 时间预期'), 'ai 建议题应单列')
  assert.ok(md.includes('C1 谁会用(未作答)'), '未作答题进待定项')
  assert.ok(md.includes('A4 屏幕方向'), '手机题在总表')
  assert.ok(md.includes('A5 离线使用(未作答)'), '可见未作答题进待定项清单')
  // 隐藏题不进总表:A4 无手机平台时不出现
  const md2 = buildProjectBrief({ answers: { A1: choice('web') } })
  assert.ok(!md2.includes('A4 屏幕方向'), '隐藏题不进立项单')
}

// ── 技术栈预设(§3.7)──
assert.equal(TECH_STACK_PRESETS.length, 4)
assert.ok(TECH_STACK_PRESETS[1].stacks.includes('React Native(Expo)'))

// ── 预填第二步(§2/G 组)──
{
  const p = quizPrefill({
    A1: choice('phone'),
    G1: choice('tinted'),
    G4: choice('compact'),
    D9: choice('enhanced')
  })
  assert.equal(p.platform, 'phone')
  assert.equal(p.templateId, 'tint-phone')
  assert.equal(p.a11yEnhanced, true)
  // 密度覆盖:compact ×0.85 后回到 2px 网格,全部小于等于基准
  const md = p.overrides['control-md']
  assert.equal(md?.kind === 'dimension' && md.px, 34, 'control-md 40×0.85=34')
  for (const key of ['space-1', 'space-4', 'space-8']) {
    const v = p.overrides[key]
    assert.equal(v?.kind, 'dimension')
    assert.equal(v.kind === 'dimension' && v.px % 2, 0, '密度覆盖须落在 2px 步长网格')
  }
}
{
  const p = quizPrefill({ A1: choice('web'), G1: choice('glass') })
  assert.equal(p.platform, 'desktop', '网页先按电脑端画布')
  assert.equal(p.templateId, null, '未实现风格不预填模板')
  assert.equal(p.styleId, 'glass')
}
{
  const p = quizPrefill({
    A1: choice('desktop'),
    G1: choice('minimal'),
    G3: { kind: 'options', ids: ['have'], extra: '#FF8800' }
  })
  assert.equal(p.templateId, 'minimal-desk')
  const c = p.overrides['color-primary']
  assert.ok(c?.kind === 'color' && c.light === '#FF8800', 'G3 已有色号预填主色')
  const bad = quizPrefill({ G3: { kind: 'options', ids: ['have'], extra: '橙色' } })
  assert.equal(bad.overrides['color-primary'], undefined, '非色号不入覆盖')
}

console.log('立项问卷数据层自测全绿')
