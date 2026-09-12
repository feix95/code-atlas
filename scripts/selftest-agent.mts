// 翻文件模式(agent)纯逻辑的自测(第一百二十八锤):工具表、路径安检、额度、
// 防打转的缰绳、token 总账。只测算得出来的东西 —— 真翻文件的执行手在主进程,
// 要等真模型联调;这边的每一条都是循环翻车的地基。
import assert from 'node:assert/strict'
import {
  AGENT_ADDENDUM,
  AGENT_KEEP_RECENT_TOOLS,
  AGENT_LIST_MAX_ENTRIES,
  AGENT_MAX_ROUNDS,
  AGENT_TOOLS,
  ROUND_CAP_NUDGE,
  REPEAT_NUDGE,
  agentPromptBudget,
  agentReadChars,
  agentStepText,
  assembleToolCalls,
  compressAgentMessages,
  estimateMessagesTokens,
  extractToolCalls,
  mergeUsage,
  parseToolArgs,
  sanitizeAgentRelPath,
  toolCallKey,
  type AgentChatMessage
} from '../src/ai/agent.ts'

function main(): void {
  // ── 1. 路径安检:项目内相对路径放行,越界的花活一律拒收 ──
  assert.equal(sanitizeAgentRelPath('src/index.ts'), 'src/index.ts', '正常相对路径原样通过')
  assert.equal(sanitizeAgentRelPath(''), '', '空串 = 项目根目录,放行')
  assert.equal(sanitizeAgentRelPath('  src/a.ts  '), 'src/a.ts', '首尾空白剪掉')
  assert.equal(sanitizeAgentRelPath('src\\a.ts'), 'src/a.ts', '反斜杠统一成正斜杠')
  assert.equal(sanitizeAgentRelPath('./src/a.ts'), 'src/a.ts', '当前目录记号洗掉')
  assert.equal(sanitizeAgentRelPath(null), null, '不是字符串拒收')
  assert.equal(sanitizeAgentRelPath('..'), null, '光上跳拒收')
  assert.equal(sanitizeAgentRelPath('src/../../secret.txt'), null, '夹带上跳拒收')
  assert.equal(sanitizeAgentRelPath('C:/Windows/system32'), null, '盘符注入拒收')
  assert.equal(sanitizeAgentRelPath('/etc/passwd'), null, '绝对路径拒收')
  assert.equal(sanitizeAgentRelPath('.\\..\\secrets'), null, '反斜杠版上跳也拒收')

  // ── 2. 读文件额度:看锅下菜,穷有底富有顶(第一百三十七锤放宽一档,压缩接客) ──
  assert.equal(agentReadChars(4096), 2000, '小锅触底:一段也保 2000 字')
  assert.equal(agentReadChars(16384), 5461, '16384 的锅读约 5461 字')
  assert.equal(agentReadChars(32768), 10922, '32768 的锅读约 10922 字')
  assert.equal(agentReadChars(65536), 12000, '大锅封顶:最多 12000 字')

  // ── 3. 工具参数清洗:arguments 是字符串 JSON、直接对象、坏账三种都接得住 ──
  assert.deepEqual(parseToolArgs('{"relPath":"src"}'), { relPath: 'src' }, '字符串 JSON 解析')
  assert.deepEqual(parseToolArgs({ relPath: 'src' }), { relPath: 'src' }, '直接对象原样通过')
  assert.equal(parseToolArgs('not json'), null, '坏 JSON 给 null,不炸循环')
  assert.equal(parseToolArgs(null), null, '空参数给 null')

  // ── 4. 工具调用抽取:缺 id 补序号,坏参不拖垮整轮 ──
  const calls = extractToolCalls({
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'call_1', type: 'function', function: { name: 'list_files', arguments: '{"relPath":"src"}' } },
      { type: 'function', function: { name: 'read_file', arguments: '{bad json' } }
    ]
  })
  assert.equal(calls.length, 2, '两条调用都收进来')
  assert.equal(calls[0].id, 'call_1', '有 id 用原 id')
  assert.equal(calls[1].id, 'call_1', '缺 id 的按序号补兜底(第二条 index=1)')
  assert.equal(calls[1].args, null, '坏参数解析为 null')

  // ── 5. 防打转:同键第二次就算重复 ──
  const done = new Set<string>()
  const key = toolCallKey('read_file', 'src/index.ts')
  assert.equal(done.has(key), false, '第一遍不算重复')
  done.add(key)
  assert.equal(done.has(key), true, '第二遍就算重复')
  assert.ok(REPEAT_NUDGE.includes('已经看过'), '重复提醒要说人话')
  assert.ok(ROUND_CAP_NUDGE.includes('别再调用'), '逼卷令要拦住工具')

  // ── 6. 工具表:只有「看」的两件,写文件的工具根本不存在 ──
  assert.equal(AGENT_TOOLS.length, 2, '只发两件工具')
  assert.deepEqual(
    AGENT_TOOLS.map((t) => t.function.name),
    ['list_files', 'read_file'],
    '工具名单对齐:列名单 + 读文件'
  )
  for (const tool of AGENT_TOOLS) {
    assert.deepEqual(tool.function.parameters.required, ['relPath'], `${tool.function.name} 必须带 relPath`)
  }

  // ── 7. 步骤播报:翻什么、看成没看成,一句大白话 ──
  assert.ok(agentStepText('list_files', 'src', 'done', '共 3 个').includes('src'), '翻完要带上目标名')
  assert.ok(agentStepText('read_file', 'src/a.ts', 'done').includes('读了'), '读文件说「读了」')
  assert.ok(agentStepText('read_file', 'src/a.ts', 'repeat').includes('已经看过'), '重复翻看有专门的话')
  assert.ok(agentStepText('list_files', 'src', 'error', '路径越界').includes('看不了'), '翻不了要老实说')

  // ── 8. token 总账:读写累加,速度认最后一轮 ──
  assert.deepEqual(
    mergeUsage({ promptTokens: 100, outputTokens: 50, tokensPerSecond: 30 }, { promptTokens: 200, outputTokens: 80, tokensPerSecond: 25 }),
    { promptTokens: 300, outputTokens: 130, tokensPerSecond: 25 },
    '两轮的账加成一本,速度认最后一轮'
  )
  assert.deepEqual(mergeUsage(undefined, { promptTokens: 9 }), { promptTokens: 9 }, '空账并入实账')
  assert.equal(mergeUsage(undefined, undefined), undefined, '两轮都没账就是没账')

  // ── 9. 缰绳的数:轮数封顶、名单封顶、守则垫在人设后 ──
  assert.ok(AGENT_MAX_ROUNDS >= 4 && AGENT_MAX_ROUNDS <= 12, '轮数封顶得是个讲道理的数')
  assert.ok(AGENT_LIST_MAX_ENTRIES >= 100, '名单封顶不能小气到列不完小项目')
  assert.ok(AGENT_ADDENDUM.includes('翻文件') && AGENT_ADDENDUM.includes('相对路径'), '守则要教模型用相对路径翻文件')

  // ── 10. 流式工具调用碎片的拼装(第一百三十四锤):参数逐段续、多调用按 index 分组 ──
  const assembled = assembleToolCalls([
    { index: 0, id: 'call_a', function: { name: 'list_files', arguments: '' } },
    { index: 0, function: { arguments: '{"relPath":"s' } },
    { index: 0, function: { arguments: 'rc"}' } },
    { index: 1, id: 'call_b', function: { name: 'read_file', arguments: '{"relPa' } },
    { index: 1, function: { arguments: 'th":"README.md"}' } }
  ])
  assert.equal(assembled.length, 2, '两个 index 拼成两个调用')
  assert.equal(assembled[0].id, 'call_a', 'id 认首帧的')
  assert.equal(assembled[0].name, 'list_files', '名字认首帧的')
  assert.deepEqual(assembled[0].args, { relPath: 'src' }, 'arguments 分段续成完整 JSON')
  assert.deepEqual(assembled[1].args, { relPath: 'README.md' }, '第二个调用的参数同样拼得齐')
  const [noIndex] = assembleToolCalls([{ function: { name: 'read_file', arguments: '{"relPath":"x"}' } }])
  assert.equal(noIndex.id, 'call_0', '缺 index 的当第 0 个,id 补序号')
  const [noArgs] = assembleToolCalls([{ index: 0, id: 'c', function: { name: 'list_files' } }])
  assert.equal(noArgs.args, null, '一个字参数都没给的,args 为 null 走「参数不合法」的喂回')

  // ── 11. 上下文自动压缩(第一百三十七锤):锅快满时旧资料变纸条,近的留原样 ──
  const longContent = 'A'.repeat(2000)
  const shortContent = 'B'.repeat(100)
  const conversation: AgentChatMessage[] = [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '帮我找东西' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"relPath":"a.ts"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: longContent },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"relPath":"b.ts"}' } }] },
    { role: 'tool', tool_call_id: 'c2', content: longContent },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c3', type: 'function', function: { name: 'read_file', arguments: '{"relPath":"c.ts"}' } }] },
    { role: 'tool', tool_call_id: 'c3', content: longContent },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c4', type: 'function', function: { name: 'read_file', arguments: '{"relPath":"d.ts"}' } }] },
    { role: 'tool', tool_call_id: 'c4', content: shortContent }
  ]
  const budget = agentPromptBudget(16384, 2048)
  assert.ok(budget >= 8000 && budget <= 20000, '16384 的锅扣完答案额度再打八折,警戒线是个讲道理的数')
  assert.equal(compressAgentMessages(conversation, Number.MAX_SAFE_INTEGER), null, '账面没超预算:一根手指都不动')
  const squeezed = compressAgentMessages(conversation, 100)
  assert.ok(squeezed, '超了预算:要动手压缩')
  assert.equal(squeezed!.compressedCount, 2, '四条工具结果里,两条长的旧账压成纸条')
  assert.deepEqual(squeezed!.freedCallIds, ['c1', 'c2'], '被压的 id 上报名单,主进程好解锁重读')
  const squeezedTools = squeezed!.messages.filter((m) => m.role === 'tool')
  assert.ok(squeezedTools[0].content.includes('占位纸条'), '旧账第一条换成了纸条')
  assert.ok(squeezedTools[0].content.includes('2000'), '纸条注明原文约多少字')
  assert.ok(squeezedTools[1].content.includes('占位纸条'), '旧账第二条同样换成纸条')
  assert.equal(squeezedTools[2].content, longContent, '倒数第二条留原样:最新的资料模型正要用')
  assert.equal(squeezedTools[3].content, shortContent, '最新一条留原样')
  assert.deepEqual(squeezed!.messages[0], conversation[0], '人设不碰')
  assert.deepEqual(squeezed!.messages[1], conversation[1], '用户的提问不碰')
  assert.equal(squeezed!.messages.length, conversation.length, '只缩内容不动条数:tool 和 tool_calls 的对账关系不破')
  assert.ok(conversation[3].role === 'tool' && conversation[3].content === longContent, '原对话数组一个字都不动(纯函数)')
  assert.equal(compressAgentMessages(conversation, estimateMessagesTokens(conversation)), null, '账面刚好等于预算:不压')
  assert.ok(AGENT_KEEP_RECENT_TOOLS >= 1 && AGENT_KEEP_RECENT_TOOLS <= 4, '留原样的条数得是个讲道理的数')

  console.log('✅ agent 纯逻辑自测:路径安检 / 额度 / 参数清洗 / 缰绳 / 播报话术 / 流式碎片拼装 / 自动压缩 全部通过')
}

main()
