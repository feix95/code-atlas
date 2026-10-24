import assert from 'node:assert/strict'
import { collectHistoryRounds, CHAT_HISTORY_SEND_MAX } from '../src/shared/chatHistory.ts'
import { PROVIDER_TIER, tierOfProvider } from '../src/shared/aiTier.ts'
import {
  estimateThreadTokens,
  flattenToolMessages,
  pairRounds,
  planChatHistory,
  planSmallTierHistory,
  smallTierHistoryBudget,
  toPlainHistory,
  toTurnRecord
} from '../src/ai/chatThread.ts'
import { createChatSessionStore, sanitizeConversationId } from '../src/ai/chatSessions.ts'
import {
  buildFileMemoNote,
  createChatFileMemoStore,
  sanitizeFileMemo
} from '../src/ai/chatFileMemo.ts'
import { TAG } from '../src/shared/promptTags.ts'
import { buildFreeChatMessages, sanitizeHistory } from '../src/ai/chat.ts'
import { droppedRoundsNotice, planChatMemory, rememberAgentTurn } from '../src/main/chatMemory.ts'

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) }
})
const bigResult = (tag: string) => `<tool_result>\n${tag}${'文件内容'.repeat(300)}\n</tool_result>`
const trace = (files: string[]) =>
  files.flatMap((file, i) => [
    {
      role: 'assistant' as const,
      content: '',
      tool_calls: [toolCall(`call_${i}`, 'read_file', { relPath: file })]
    },
    { role: 'tool' as const, tool_call_id: `call_${i}`, content: bigResult(file) }
  ])
const record = (question: string, answer: string, files: string[]) => ({
  question,
  answer,
  trace: trace(files)
})
const rounds = (...qa: Array<[string, string]>) =>
  qa.flatMap(([question, answer]) => [
    { role: 'user', content: question },
    { role: 'assistant', content: answer }
  ])

// 症结一:翻文件多轮回答中,封板的叙述气泡不许顶替最终答案进历史
{
  const history = collectHistoryRounds(
    [
      { role: 'user', state: 'done', text: '这个小笔误指什么?' },
      { role: 'assistant', state: 'done', text: '我先读一下这个文件' },
      { role: 'note', state: 'done', text: '读了「格式漂移.md」' },
      { role: 'assistant', state: 'done', text: '你说得对,我得去文件里搜一下' },
      { role: 'note', state: 'done', text: '搜了「Drift」' },
      { role: 'assistant', state: 'done', text: '最终答案:标题是格式漂移,英文 Format Drift' }
    ],
    CHAT_HISTORY_SEND_MAX
  )
  assert.deepEqual(
    history.map((m) => m.content),
    ['这个小笔误指什么?', '最终答案:标题是格式漂移,英文 Format Drift'],
    '一轮问答只收最后一个回答气泡,叙述气泡不顶替最终答案'
  )
  // 最后一个回答气泡没完工(busy/error)时整轮不要,不退而求其次拿叙述气泡
  const unfinished = collectHistoryRounds(
    [
      { role: 'user', state: 'done', text: '问' },
      { role: 'assistant', state: 'done', text: '我先读一下' },
      { role: 'assistant', state: 'error', text: '' }
    ],
    CHAT_HISTORY_SEND_MAX
  )
  assert.deepEqual(unfinished, [], '最终气泡出错的轮整轮扔')
}

// 症结二:长回答的结尾不许被截掉(用户追问「你刚才最后说的那个」)
const REMARK = '顺便提一句:文档标题其实写的是「格式漂移」,和正文的 Format Drift 是同一个词。'
const longAnswer = `${'前面是一大段讲解。'.repeat(120)}${REMARK}`
{
  const history = rounds(
    ['格式漂移是什么?', longAnswer],
    ['怎么治?', '三层手段:模型层、提示词层、工程层。'],
    ['还有别的吗?', '还可以加重试兜底。']
  )
  assert.ok(
    !sanitizeHistory(history).some((m) => m.content.includes(REMARK)),
    '大模型档保持旧行为:单条历史截到 500 字,结尾丢失(对照基线)'
  )
  const plan = planChatMemory({
    body: { history },
    provider: 'builtin',
    contextTokens: 16384,
    fixedTokens: 3000,
    replyTokens: 1024
  })
  assert.ok(
    plan.planned.messages.some((m) => typeof m.content === 'string' && m.content.includes(REMARK)),
    '小模型档按预算装,长回答结尾完整保留'
  )
  assert.equal(plan.planned.droppedRounds, 0)
  assert.ok(
    plan.planned.messages.every(
      (m) => typeof m.content !== 'string' || !m.content.includes('不用接着写')
    ),
    '小模型档不再垫「不用续写」注记'
  )
}

// 分档:按来源,漏登记 typecheck 会红
assert.equal(tierOfProvider('builtin'), 'small')
assert.equal(tierOfProvider('lmstudio'), 'small')
assert.equal(tierOfProvider('cloud'), 'large')
assert.deepEqual(Object.keys(PROVIDER_TIER).sort(), ['builtin', 'cloud', 'lmstudio'])

// 大模型档:行为不变(历史、装配、会话记忆都不碰)
{
  const history = rounds(
    ['一', '答一'],
    ['二', longAnswer],
    ['三', '答三'],
    ['四', '答四'],
    ['五', '答五']
  )
  const legacy = sanitizeHistory(history)
  const large = planChatHistory({
    tier: 'large',
    history,
    records: [record('二', longAnswer, ['a.ts'])],
    budgetTokens: 1
  })
  assert.deepEqual(
    large.messages,
    legacy,
    '大模型档历史与旧 sanitizeHistory 逐条一致,不看预算也不看会话记录'
  )
  assert.equal(large.droppedRounds, 0)
  // 渲染层改成多发(40)后,大模型档收到的结果与原先发 8 条时完全相同
  const ui = [
    ...Array.from({ length: 12 }, (_, i) => [
      { role: 'user', state: 'done', text: `问${i}` },
      { role: 'assistant', state: 'done', text: `答${i}` }
    ]).flat()
  ]
  assert.deepEqual(
    sanitizeHistory(collectHistoryRounds(ui, CHAT_HISTORY_SEND_MAX)),
    sanitizeHistory(collectHistoryRounds(ui, 8)),
    '渲染层多发不改变大模型档最终进提示词的历史'
  )
  const cloudBody = { history: rounds(['问', '答']), agent: true, conversationId: 'c-cloud' }
  const cloudPlan = planChatMemory({
    body: cloudBody,
    provider: 'cloud',
    contextTokens: 131072,
    fixedTokens: 3000,
    replyTokens: 1024
  })
  rememberAgentTurn(cloudPlan, '问', trace(['a.ts']), '答')
  const probe = planChatMemory({
    body: cloudBody,
    provider: 'builtin',
    contextTokens: 16384,
    fixedTokens: 3000,
    replyTokens: 1024
  })
  assert.ok(
    probe.planned.messages.every((m) => m.role !== 'tool'),
    '在线 API 的翻文件往来一条都没记进会话库'
  )
  assert.deepEqual(
    planChatMemory({
      body: { history },
      provider: 'cloud',
      contextTokens: 131072,
      fixedTokens: 0,
      replyTokens: 1024
    }).planned.messages,
    sanitizeHistory(history),
    '在线 API 走旧历史'
  )
}

// 会话加料:问+答对上记录的轮拿回完整工具往来;对不上的退回纯文字
{
  const history = rounds(['看看 a.ts', '它在做 A'], ['再看 b.ts', '它在做 B'])
  const planned = planSmallTierHistory({
    history,
    records: [
      record('看看 a.ts', '它在做 A', ['a.ts']),
      record('再看 b.ts', '被改过的答案', ['b.ts'])
    ],
    budgetTokens: 1_000_000
  })
  const roles = planned.messages.map((m) => m.role)
  assert.deepEqual(
    roles,
    ['user', 'assistant', 'tool', 'assistant', 'user', 'assistant'],
    '对上的轮带工具往来,对不上的轮纯文字'
  )
  const first = planned.messages[1]
  assert.equal(first.role, 'assistant')
  assert.ok(
    'tool_calls' in first && first.tool_calls?.[0].id === 'h0_call_0',
    '历史工具调用 id 加轮次前缀防撞'
  )
  const tool = planned.messages[2]
  assert.ok(tool.role === 'tool' && tool.tool_call_id === 'h0_call_0', 'tool 结果的 id 同步改')
  assert.deepEqual(
    planSmallTierHistory({ history, records: [], budgetTokens: 1_000_000 }).messages,
    history,
    '没有任何记录时就是原样纯文字历史'
  )
  assert.deepEqual(toPlainHistory(planned.messages), history, '摘掉工具往来后,问和最终答案一条不少')
}

// 装不下:先遮蔽旧工具原文 → 再丢最旧整轮 → 最近一轮退纯文字
{
  const history = rounds(['问 a', '答 a'], ['问 b', '答 b'], ['问 c', '答 c'])
  const records = [
    record('问 a', '答 a', ['src/a.ts']),
    record('问 b', '答 b', ['src/b.ts']),
    record('问 c', '答 c', ['src/c.ts'])
  ]
  const full = planSmallTierHistory({ history, records, budgetTokens: 1_000_000 })
  assert.equal(full.maskedRounds, 0)
  const fullTokens = estimateThreadTokens(full.messages)
  const squeezed = planSmallTierHistory({ history, records, budgetTokens: fullTokens - 500 })
  assert.equal(squeezed.droppedRounds, 0, '遮蔽够用就不丢整轮')
  assert.ok(squeezed.maskedRounds >= 1)
  const toolTexts = squeezed.messages.flatMap((m) => (m.role === 'tool' ? [m.content] : []))
  assert.ok(
    toolTexts[0].includes('早先翻看的资料') && toolTexts[0].includes('src/a.ts'),
    '最旧的工具原文被换成占位注记,点明翻的是什么'
  )
  assert.ok(
    toolTexts[0].includes('允许重读') && toolTexts[0].includes('原文约'),
    '注记写明原文长度并允许重读'
  )
  assert.equal(toolTexts[toolTexts.length - 1], bigResult('src/c.ts'), '最近一轮的工具原文原样保留')
  assert.ok(
    squeezed.messages.filter((m) => m.role === 'assistant' && 'tool_calls' in m).length === 3,
    '遮蔽只动 tool 内容,assistant 的 tool_calls 一条不少,成对关系不破'
  )
  const again = planSmallTierHistory({ history, records, budgetTokens: fullTokens - 500 })
  assert.deepEqual(again, squeezed, '同样输入同样输出,开头不乱动才吃得到引擎前缀缓存')

  const tiny = planSmallTierHistory({ history, records, budgetTokens: 5 })
  assert.equal(tiny.keptRounds, 1, '再挤也至少留最近一轮')
  assert.equal(tiny.droppedRounds, 2)
  assert.deepEqual(
    tiny.messages.map((m) => m.role),
    ['user', 'assistant'],
    '最近一轮也装不下时退成纯文字问答'
  )
  assert.ok(droppedRoundsNotice(tiny)?.includes('/compact'))
  assert.equal(droppedRoundsNotice(full), null, '没丢就不打扰用户')
}

// 记档与对账:翻文件交卷后记下,下一轮请求拿得回来
{
  const body = { agent: true, conversationId: 'conv-1' }
  const firstPlan = planChatMemory({
    body: { ...body, history: [] },
    provider: 'lmstudio',
    contextTokens: 16384,
    fixedTokens: 2000,
    replyTokens: 1024
  })
  rememberAgentTurn(firstPlan, '看看 a.ts', trace(['a.ts']), '它在做 A')
  const secondPlan = planChatMemory({
    body: { ...body, history: rounds(['看看 a.ts', '它在做 A']) },
    provider: 'lmstudio',
    contextTokens: 16384,
    fixedTokens: 2000,
    replyTokens: 1024
  })
  assert.ok(
    secondPlan.planned.messages.some((m) => m.role === 'tool'),
    '第二轮能拿回第一轮翻文件的往来'
  )
  const plainTurn = planChatMemory({
    body: { agent: false, conversationId: 'conv-1', history: rounds(['看看 a.ts', '它在做 A']) },
    provider: 'lmstudio',
    contextTokens: 16384,
    fixedTokens: 2000,
    replyTokens: 1024
  })
  assert.ok(
    plainTurn.planned.messages.every((m) => m.role !== 'tool'),
    '翻文件关着的请求不带工具往来'
  )
  const otherConv = planChatMemory({
    body: { agent: true, conversationId: 'conv-2', history: rounds(['看看 a.ts', '它在做 A']) },
    provider: 'lmstudio',
    contextTokens: 16384,
    fixedTokens: 2000,
    replyTokens: 1024
  })
  assert.ok(
    otherConv.planned.messages.every((m) => m.role !== 'tool'),
    '别的会话互不串'
  )
}

// 小件:洗数据、预算、摘工具、存档洗形
{
  assert.deepEqual(pairRounds('乱七八糟'), [])
  assert.deepEqual(
    pairRounds([
      { role: 'assistant', content: '孤零零的答' },
      { role: 'user', content: ' 问 ' },
      { role: 'user', content: '又一问' },
      { role: 'assistant', content: ' 答 ' },
      { role: 'tool', content: 'x' },
      null
    ]),
    [{ question: '又一问', answer: '答' }],
    '只认紧邻的问答对,脏条目与悬空问题跳过'
  )
  assert.equal(
    smallTierHistoryBudget({ contextTokens: 16384, fixedTokens: 3000, replyTokens: 1024 }),
    6180
  )
  assert.equal(
    smallTierHistoryBudget({ contextTokens: 4096, fixedTokens: 4000, replyTokens: 1024 }),
    1024,
    '上下文再紧也有保底'
  )
  const flat = flattenToolMessages([
    { role: 'user', content: '问' },
    { role: 'assistant', content: '我去翻翻', tool_calls: [toolCall('c', 'read_file', {})] },
    { role: 'tool', tool_call_id: 'c', content: 'x' },
    { role: 'assistant', content: '答' }
  ])
  assert.deepEqual(
    flat.map((m) => [m.role, m.content]),
    [
      ['user', '问'],
      ['assistant', '我去翻翻'],
      ['assistant', '答']
    ],
    '摘掉 tool 消息与 tool_calls,叙述文字保留'
  )
  const rec = toTurnRecord(
    ' 问 ',
    [
      { role: 'assistant', content: null, tool_calls: [toolCall('c', 'read_file', {})] },
      { role: 'tool', tool_call_id: 'c', content: 'x' },
      { role: 'user', content: '提醒卡不该进来' }
    ] as never,
    ' 答 '
  )
  assert.deepEqual(
    rec.trace.map((m) => m.role),
    ['assistant', 'tool'],
    '存档只收工具往来,杂项与插话不收'
  )
  assert.equal(rec.question, '问')
}

// 会话库:会话数淘汰最久没用的、单会话只记最近几轮
{
  const store = createChatSessionStore({ sessionsMax: 2, turnsPerSessionMax: 2 })
  const turn = (n: number) => ({ question: `问${n}`, answer: `答${n}`, trace: [] })
  store.record('a', turn(1))
  store.record('b', turn(2))
  store.record('a', turn(3))
  store.record('c', turn(4))
  assert.equal(store.turns('b').length, 0, 'b 最久没用,被挤出')
  assert.equal(store.turns('a').length, 2)
  store.record('a', turn(5))
  assert.deepEqual(
    store.turns('a').map((t) => t.question),
    ['问3', '问5'],
    '单会话只留最近两轮'
  )
  store.record('', turn(6))
  assert.equal(store.turns('').length, 0, '没编号不记')
  store.clear('a')
  assert.equal(store.turns('a').length, 0)
  assert.equal(sanitizeConversationId('x'.repeat(65)), '')
  assert.equal(sanitizeConversationId(42), '')
  assert.equal(sanitizeConversationId('ok'), 'ok')
}

// 装配:带工具往来的历史不被合并,纯文字历史装配与旧行为一致
{
  const richHistory = [
    { role: 'user' as const, content: '看 a' },
    { role: 'assistant' as const, content: '', tool_calls: [toolCall('h0_c', 'read_file', {})] },
    { role: 'tool' as const, tool_call_id: 'h0_c', content: 'x' },
    { role: 'tool' as const, tool_call_id: 'h0_d', content: 'y' },
    { role: 'assistant' as const, content: '答' }
  ]
  const messages = buildFreeChatMessages('SYS', null, richHistory, '新问题', null, [], 'brief')
  assert.deepEqual(
    messages.map((m) => m.role),
    ['system', 'user', 'assistant', 'tool', 'tool', 'assistant', 'user'],
    '相邻的两条 tool 消息、带 tool_calls 的 assistant 都不许被合并'
  )
  const plain = buildFreeChatMessages(
    'SYS',
    null,
    [
      { role: 'user', content: '旧问' },
      { role: 'assistant', content: '旧答' }
    ],
    '新问题',
    null,
    [],
    'brief'
  )
  assert.deepEqual(
    plain.map((m) => m.role),
    ['system', 'user', 'assistant', 'user']
  )
}

// 附件登记表(附件追问):注记记账、洗形、拼条 —— 「你读完了吗/接着读完它」的据
{
  const store = createChatFileMemoStore({ sessionsMax: 2, filesMax: 2 })
  const note = (name: string, totalLines: number, shownEndLine: number, rootId?: string) => ({
    name,
    totalLines,
    shownEndLine,
    rootId
  })
  store.update('c1', [note('a.md', 100, 100, 'external_1')])
  assert.equal(store.peek('c1')[0].name, 'a.md')
  store.update('c1', [note('b.md', 50, 20, 'external_2')])
  assert.deepEqual(
    store.peek('c1').map((f) => f.name),
    ['b.md', 'a.md'],
    '新文件排最前,旧注记还留着'
  )
  store.update('c1', [note('a.md', 100, 100, 'external_1')])
  assert.deepEqual(
    store.peek('c1').map((f) => f.name),
    ['a.md', 'b.md'],
    '同名以最新为准,不重复占位'
  )
  store.update('c1', [note('c.md', 9, 9)])
  store.update('c1', [note('d.md', 9, 9)])
  assert.deepEqual(
    store.peek('c1').map((f) => f.name),
    ['d.md', 'c.md'],
    '封顶后只留最近几张'
  )
  store.update('c1', [])
  assert.equal(store.peek('c1').length, 2, '没带附件的轮不清旧账')
  store.update('', [note('x', 1, 1)])
  assert.equal(store.peek('').length, 0, '没编号不记账')
  const capped = createChatFileMemoStore({ sessionsMax: 2, filesMax: 2 })
  capped.update('a', [note('a.md', 1, 1)])
  capped.update('b', [note('b.md', 1, 1)])
  capped.update('c', [note('c.md', 1, 1)])
  assert.equal(capped.peek('a').length, 0, '最久没用的会话被忘掉')

  // 洗形:坏条目整条丢;行账钳进范围;假格式的钥匙与越界路径丢掉
  assert.equal(sanitizeFileMemo(null), null)
  assert.equal(sanitizeFileMemo({ name: '  ', totalLines: 3 }), null)
  assert.equal(sanitizeFileMemo({ name: 'x', totalLines: 0 }), null)
  const washed = sanitizeFileMemo({
    name: ' x.md ',
    totalLines: 30,
    shownEndLine: 999,
    rootId: 'external_007',
    relPath: '..\\bad'
  })
  assert.ok(washed)
  assert.equal(washed.shownEndLine, 30, '行账钳到总行数')
  assert.equal(washed.rootId, undefined, '假格式的钥匙丢掉')
  assert.equal(washed.relPath, undefined, '越界样式的路径丢掉')

  // 拼条:整份/半份/相对路径三种说法齐活
  const full = buildFileMemoNote([
    { name: 'a.md', totalLines: 100, shownEndLine: 100, rootId: 'external_1' }
  ])
  assert.ok(full && full.startsWith(TAG.programNote.open), '注记包 program_note')
  assert.ok(full.includes('整份带的') && full.includes('rootId=external_1'), '整份的注记给重看的路')
  const partial = buildFileMemoNote([
    { name: 'b.md', totalLines: 50, shownEndLine: 20, rootId: 'external_2' }
  ])
  assert.ok(
    partial.includes('只带了第 1-20 行 / 共 50 行') && partial.includes('offset=21'),
    '没读完的注记给续读的 offset'
  )
  const pathOnly = buildFileMemoNote([
    { name: 'c.md', totalLines: 50, shownEndLine: 50, relPath: 'docs/c.md' }
  ])
  assert.ok(pathOnly.includes('docs/c.md'), '项目内文件用相对路径指路')
  assert.equal(buildFileMemoNote([]), null, '没注记不垫话')
}

console.log('selftest-chatmemory ok')
