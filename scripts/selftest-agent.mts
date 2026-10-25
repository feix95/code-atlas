// 翻文件模式(agent)纯逻辑的自测:工具表、路径安检、额度、
// 防循环护栏、token 总账。只测算得出来的东西 —— 真翻文件的执行手在主进程,
// 要等真模型联调;这边的每一条都是循环翻车的地基。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_KEEP_RECENT_TOOLS,
  AGENT_LIST_MAX_ENTRIES,
  AGENT_MAX_ROUNDS,
  AGENT_REMINDER_MAX_CHARS,
  AGENT_REMINDER_MIN_TOOL_CALLS,
  AGENT_REMINDER_PREFIX,
  AGENT_RESEARCH_PREFIX,
  AGENT_SEARCH_MAX_FILES,
  AGENT_SEARCH_MAX_MATCHES,
  AGENT_SEARCH_MAX_PATH_HITS,
  AGENT_TOOLS,
  AGENT_TOOLS_GITHUB,
  AGENT_WEB_MAX_LOOKUPS,
  AGENT_TOOLS_LOCAL,
  AGENT_WEB_ADDENDUM,
  pickAgentTools,
  ROUND_CAP_NUDGE,
  REPEAT_NUDGE,
  agentPromptBudget,
  agentReadChars,
  agentRound,
  agentStepText,
  assembleToolCalls,
  agentOnThisRound,
  buildAgentReminder,
  compressAgentMessages,
  emergencySlim,
  estimateMessagesTokens,
  extractToolCalls,
  looksLikeToolsUnsupported,
  mergeUsage,
  parseToolArgs,
  sanitizeAgentRelPath,
  stripLastAgentReminder,
  toolCallKey,
  type AgentChatMessage,
  type AgentStreamEvent
} from '../src/ai/agent.ts'
// 翻文件切片:旧 AGENT_ADDENDUM 的逐字稿新家,守口径断言都打它
import { AGENT_FILES_ADDENDUM, buildChatSystem, SLICE_NO_TOOLS } from '../src/ai/prompts.ts'
import { AGENT_RESEARCH_GATE_PREFIX } from '../src/ai/agentGuard.ts'
import {
  PLAN_RESEARCH_TOOL,
  RESEARCH_GATE_MAX_NUDGES,
  buildResearchGateNudge,
  floorFromPlan,
  parseResearchPlan,
  runResearchPlanCall,
  shouldGateAnswer,
  unmetResearchFloor
} from '../src/ai/researchPlan.ts'
import {
  TAVILY_MAX_RESULTS,
  WEB_HIT_SNIPPET_MAX_CHARS,
  WEB_PAGE_TEXT_MAX_CHARS,
  WEB_SEARCH_PAGE_COUNT,
  htmlToText,
  isPublicHttpUrl,
  parseTavilyResults,
  rewriteGithubBlobUrl,
  sanitizeWebFetchUrl,
  sanitizeWebQuery,
  webSearchDetailed,
  wikiHitsRelevant,
  type WebSearchHit
} from '../src/ai/weblookup.ts'
import {
  AgentDirectoryAccess,
  PROJECT_AGENT_ROOT,
  isPathInside,
  joinAuthorizedRoot,
  sanitizeAgentRootId,
  sanitizeExternalAbsPath
} from '../src/main/agentAccess.ts'
import { handleAgentFailure, isCutToolCall } from '../src/main/agentFallback.ts'
import { asToolName, TOOL_NAMES, TOOL_STEP_WORDS } from '../src/shared/agentTools.ts'
import {
  githubDisplayPath,
  githubRawFileUrl,
  githubRepoKey,
  listGithubTree,
  parseGithubRepoMeta,
  parseGithubTreePayload,
  parseGitHubRepoUrl,
  searchGithubTreePaths
} from '../src/ai/githubRepo.ts'

async function main(): Promise<void> {
  // 1. 路径安检:项目内相对路径放行,越界的花活一律拒收
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
  assert.equal(sanitizeExternalAbsPath('src'), null, '外部路径申请不收相对路径')
  assert.equal(
    sanitizeExternalAbsPath('C:\\outside\\demo'),
    'C:\\outside\\demo',
    '外部路径只收规范化绝对路径'
  )
  assert.equal(sanitizeAgentRootId(undefined), PROJECT_AGENT_ROOT, '不传目录编号默认项目根')
  assert.equal(sanitizeAgentRootId('external_2'), 'external_2', '临时目录编号格式放行')
  assert.equal(sanitizeAgentRootId('external_0'), null, '伪造的零号目录拒收')
  const access = new AgentDirectoryAccess()
  assert.deepEqual(
    access.resolve('E:\\project', undefined),
    { rootId: PROJECT_AGENT_ROOT, path: 'E:\\project', external: false, kind: 'dir' },
    '默认只指向当前项目'
  )
  assert.equal(access.resolve('E:\\project', 'external_1'), null, '没授权的临时编号打不开')
  const granted = access.grant('D:\\shared\\demo')
  assert.deepEqual(
    granted,
    { rootId: 'external_1', path: 'D:\\shared\\demo', kind: 'dir' },
    '首个同意目录拿到本次运行的一号授权令牌'
  )
  assert.deepEqual(access.grant('D:\\shared\\demo'), granted, '同一目录重复同意复用原授权令牌')
  assert.deepEqual(
    access.resolve('E:\\project', 'external_1'),
    { rootId: 'external_1', path: 'D:\\shared\\demo', external: true, kind: 'dir' },
    '同意后的编号只解到对应目录'
  )
  assert.equal(access.resolve('E:\\project', 'external_2'), null, '猜别的编号仍打不开')
  assert.equal(
    isPathInside('D:\\shared\\demo', 'D:\\shared\\demo\\src\\a.ts'),
    true,
    '授权目录里面的目标放行'
  )
  assert.equal(
    isPathInside('D:\\shared\\demo', 'D:\\shared\\other\\a.ts'),
    false,
    '同盘相邻目录不是授权范围'
  )
  assert.equal(isPathInside('D:\\shared\\demo', 'C:\\Windows\\a.ts'), false, '跨盘目标不是授权范围')

  // 文件授权令牌(拖入即授权):只发真实存在的单个文件;编号解得到,穿沙盒读得到
  const grantSandbox = await mkdtemp(join(tmpdir(), 'atlas-file-grant-'))
  try {
    const notePath = join(grantSandbox, 'long-note.txt')
    await writeFile(notePath, '第一行\n第二行\n第三行\n', 'utf8')
    const realNote = await realpath(notePath)
    assert.equal(await access.grantFile('relative\\note.txt'), null, '相对路径发不出文件授权令牌')
    assert.equal(
      await access.grantFile(grantSandbox),
      null,
      '文件夹走目录授权那条,不发文件授权令牌'
    )
    assert.equal(
      await access.grantFile(join(grantSandbox, 'missing.txt')),
      null,
      '不存在的文件发不出授权令牌'
    )
    const fileGrant = await access.grantFile(notePath)
    assert.ok(fileGrant, '真是文件才发授权令牌')
    assert.deepEqual(
      fileGrant,
      { rootId: 'external_2', path: realNote, kind: 'file' },
      '授权令牌记的是 realpath 后的绝对路径'
    )
    assert.deepEqual(await access.grantFile(notePath), fileGrant, '同一文件重复授权复用原授权令牌')
    assert.deepEqual(
      access.resolve('E:\\project', 'external_2'),
      { rootId: 'external_2', path: realNote, external: true, kind: 'file' },
      '文件授权令牌编号只解到那份文件'
    )
    assert.equal(
      await joinAuthorizedRoot(realNote, ''),
      realNote,
      '穿沙盒:relPath 空串直达文件本体'
    )
    await assert.rejects(joinAuthorizedRoot(realNote, 'x.txt'), '穿沙盒:带子路径越不过去')
    await assert.rejects(joinAuthorizedRoot(realNote, '../x'), '穿沙盒:上跳越不过去')
    const githubGrant = access.grantGithub('github.com/foo/bar@main')
    assert.deepEqual(
      githubGrant,
      { rootId: 'github_1', path: 'github.com/foo/bar@main', kind: 'github' },
      '公开仓库拿到独立的 github_ 编号,不跟本地令牌抢号'
    )
    assert.deepEqual(
      access.grantGithub('github.com/foo/bar@main'),
      githubGrant,
      '同一仓库同一分支重复打开复用原授权令牌'
    )
    assert.deepEqual(
      access.resolve('E:\\project', 'github_1'),
      {
        rootId: 'github_1',
        path: 'github.com/foo/bar@main',
        external: true,
        kind: 'github'
      },
      'GitHub 编号只解到那份远程展示名'
    )
    assert.equal(sanitizeAgentRootId('github_1'), 'github_1', 'github_ 编号格式放行')
    assert.equal(sanitizeAgentRootId('github_0'), null, '伪造的零号 GitHub 根拒收')
  } finally {
    await rm(grantSandbox, { recursive: true, force: true })
  }

  // 2. 读文件额度:按上下文窗口缩放,有下限有上限(放宽一档,压缩接客)
  assert.equal(agentReadChars(4096), 2000, '小上下文达下限:一段也保 2000 字')
  assert.equal(agentReadChars(16384), 5461, '16384 token 上下文读约 5461 字')
  assert.equal(agentReadChars(32768), 10922, '32768 token 上下文读约 10922 字')
  assert.equal(agentReadChars(65536), 12000, '大上下文封顶:最多 12000 字')

  // 3. 工具参数清洗:arguments 是字符串 JSON、直接对象、坏账三种都接得住
  assert.deepEqual(parseToolArgs('{"relPath":"src"}'), { relPath: 'src' }, '字符串 JSON 解析')
  assert.deepEqual(parseToolArgs({ relPath: 'src' }), { relPath: 'src' }, '直接对象原样通过')
  assert.equal(parseToolArgs('not json'), null, '坏 JSON 给 null,不炸循环')
  assert.equal(parseToolArgs(null), null, '空参数给 null')

  // 4. 工具调用抽取:缺 id 补序号,坏参不拖垮整轮
  const calls = extractToolCalls({
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'list_files', arguments: '{"relPath":"src"}' }
      },
      { type: 'function', function: { name: 'read_file', arguments: '{bad json' } }
    ]
  })
  assert.equal(calls.length, 2, '两条调用都收进来')
  assert.equal(calls[0].id, 'call_1', '有 id 用原 id')
  assert.equal(calls[1].id, 'call_1', '缺 id 的按序号补兜底(第二条 index=1)')
  assert.equal(calls[1].args, null, '坏参数解析为 null')

  // 5. 防打转:同键第二次就算重复
  const done = new Set<string>()
  const key = toolCallKey('read_file', 'src/index.ts')
  assert.equal(done.has(key), false, '第一遍不算重复')
  done.add(key)
  assert.equal(done.has(key), true, '第二遍就算重复')
  assert.ok(REPEAT_NUDGE.includes('已经看过'), '重复提醒要说人话')
  assert.ok(ROUND_CAP_NUDGE.includes('别再调用'), '逼卷令要拦住工具')

  // 6. 工具表:本地只有「看」的四件,写文件的工具根本不存在;联网开着才多 web_search / web_fetch
  assert.equal(AGENT_TOOLS_LOCAL.length, 4, '本地发三件只读工具和一件临时目录授权工具')
  assert.deepEqual(
    AGENT_TOOLS_LOCAL.map((t) => t.function.name),
    ['list_files', 'read_file', 'search_content', 'request_directory_access'],
    '工具名单对齐:列名单 + 读文件 + 搜内容 + 申请外部目录'
  )
  assert.equal(
    AGENT_TOOLS.length,
    8,
    '联网查证开着,全量工具表多 web_search、web_fetch、save_research_note 和 open_github_repo'
  )

  // 工具名总账(shared/agentTools):名单、词表、认名闸三样互相对得上 —— 多一件少一件当场拦
  // 计划表(plan_research)只走首轮强制调用、不在常规工具表里,但照样要登记
  const registered = Object.values(TOOL_NAMES)
  assert.equal(registered.length, 9, '登记表登记九件工具')
  assert.deepEqual(
    AGENT_TOOLS.map((t) => t.function.name).sort(),
    registered.filter((name) => name !== TOOL_NAMES.planResearch).sort(),
    '发给模型的常规工具表 = 登记表去掉计划表'
  )
  assert.deepEqual(
    Object.keys(TOOL_STEP_WORDS).sort(),
    [...registered].sort(),
    '播报词表和登记表同一份名单'
  )
  for (const name of registered) assert.equal(asToolName(name), name, `登记表能认出 ${name}`)
  assert.equal(asToolName('delete_file'), null, '不认识的工具名拒收(写文件工具不存在)')
  assert.equal(asToolName(''), null, '空名拒收')

  const listTool = AGENT_TOOLS_LOCAL.find((t) => t.function.name === 'list_files')!
  const readTool = AGENT_TOOLS_LOCAL.find((t) => t.function.name === 'read_file')!
  const searchTool = AGENT_TOOLS_LOCAL.find((t) => t.function.name === 'search_content')!
  const accessTool = AGENT_TOOLS_LOCAL.find((t) => t.function.name === 'request_directory_access')!
  assert.deepEqual(listTool.function.parameters.required, ['relPath'], 'list_files 必须带 relPath')
  assert.deepEqual(readTool.function.parameters.required, ['relPath'], 'read_file 必须带 relPath')
  assert.deepEqual(
    searchTool.function.parameters.required,
    ['keyword'],
    'search_content 必须带 keyword'
  )
  assert.deepEqual(accessTool.function.parameters.required, ['path'], '申请目录必须带绝对路径')
  assert.ok(listTool.function.parameters.properties.rootId, 'list_files 能带临时目录编号')
  assert.ok(readTool.function.parameters.properties.rootId, 'read_file 能带临时目录编号')
  assert.ok(searchTool.function.parameters.properties.rootId, 'search_content 能带临时目录编号')
  assert.ok(searchTool.function.parameters.properties.relPath, 'search_content 的范围参数可选')
  // read_file 翻页参数(对齐 Claude Code 的 Read):offset/limit 可选项,续读靠它
  assert.ok(readTool.function.parameters.properties.offset, 'read_file 能带 offset 从某一行接着读')
  assert.ok(readTool.function.parameters.properties.limit, 'read_file 能带 limit 限定行数')
  assert.ok(
    readTool.function.description.includes('行号'),
    'read_file 的描述说清每行带行号(模型要靠它对行账)'
  )

  // web_search 的必填是搜索词 query;source 分流已随统一源队列退役(2026-09-17:Tavily→DDG→维基)
  const webTool = AGENT_TOOLS.find((t) => t.function.name === 'web_search')!
  assert.deepEqual(webTool.function.parameters.required, ['query'], 'web_search 必须带 query')
  assert.ok(
    !webTool.function.parameters.properties.source,
    'source 参数已退役:源序程序统一排,不让模型挑'
  )
  const fetchTool = AGENT_TOOLS.find((t) => t.function.name === 'web_fetch')!
  assert.deepEqual(fetchTool.function.parameters.required, ['url'], 'web_fetch 必须带 url')
  const noteTool = AGENT_TOOLS.find((t) => t.function.name === 'save_research_note')!
  assert.deepEqual(noteTool.function.parameters.required, ['note'], '研究笔记必须带 note')
  const githubTool = AGENT_TOOLS.find((t) => t.function.name === 'open_github_repo')!
  assert.deepEqual(githubTool.function.parameters.required, ['url'], '打开仓库必须带 url')
  assert.deepEqual(pickAgentTools(true, true), AGENT_TOOLS, '网页预算还在时发全量工具表(含 GitHub)')
  assert.deepEqual(
    pickAgentTools(false, true).map((t) => t.function.name),
    AGENT_TOOLS_GITHUB.map((t) => t.function.name),
    '网页预算用完仍留 open_github_repo'
  )
  assert.deepEqual(pickAgentTools(false, false), AGENT_TOOLS_LOCAL, '没开联网只发本地四件')

  // 7. 步骤播报:翻什么、看成没看成,一句大白话
  assert.ok(
    agentStepText('list_files', 'src', 'done', '共 3 个').includes('src'),
    '翻完要带上目标名'
  )
  assert.ok(agentStepText('read_file', 'src/a.ts', 'done').includes('读了'), '读文件说「读了」')
  assert.ok(
    agentStepText('search_content', '500', 'done', '整个项目命中 12 处').includes('搜了'),
    '搜内容说「搜了」'
  )
  assert.ok(
    agentStepText('search_content', '500', 'done', '整个项目命中 12 处').includes('命中 12 处'),
    '搜索步骤带命中数'
  )
  assert.ok(
    agentStepText('read_file', 'src/a.ts', 'repeat').includes('已经看过'),
    '重复翻看有专门的话'
  )
  assert.ok(
    agentStepText('list_files', 'src', 'error', '路径越界').includes('看不了'),
    '翻不了要老实说'
  )
  assert.ok(
    agentStepText('web_search', 'skills 装在哪', 'done', '维基百科(中文)').includes('上网查了'),
    '查网说「上网查了」'
  )
  assert.ok(
    agentStepText('web_search', 'skills 装在哪', 'repeat').includes('查过'),
    '重复查有专门的话'
  )
  assert.ok(
    agentStepText('web_search', 'skills 装在哪', 'error', '没查到').includes('查不了'),
    '查网失败说「查不了」'
  )
  assert.ok(
    agentStepText('web_fetch', 'https://example.com', 'done').includes('打开了'),
    '打开网页说「打开了」'
  )
  assert.ok(
    agentStepText('open_github_repo', 'https://github.com/foo/bar', 'done').includes('GitHub'),
    '打开仓库说「GitHub 仓库」'
  )

  // 8. token 总账:读写累加,速度认最后一轮
  assert.deepEqual(
    mergeUsage(
      { promptTokens: 100, outputTokens: 50, tokensPerSecond: 30 },
      { promptTokens: 200, outputTokens: 80, tokensPerSecond: 25 }
    ),
    { promptTokens: 300, outputTokens: 130, tokensPerSecond: 25 },
    '两轮的账加成一本,速度认最后一轮'
  )
  assert.deepEqual(mergeUsage(undefined, { promptTokens: 9 }), { promptTokens: 9 }, '空账并入实账')
  assert.equal(mergeUsage(undefined, undefined), undefined, '两轮都没账就是没账')

  // 9. 护栏阈值:轮数封顶、名单封顶、搜索封顶、守则垫在人设后
  assert.ok(AGENT_MAX_ROUNDS >= 4 && AGENT_MAX_ROUNDS <= 32, '轮数封顶得是个讲道理的数')
  assert.equal(AGENT_MAX_ROUNDS, 24, '翻文件轮次封顶 24,留给远程根翻文件')
  assert.equal(AGENT_WEB_MAX_LOOKUPS, 20, '联网研究预算固定 20 次,只防无界搜索')
  assert.ok(AGENT_LIST_MAX_ENTRIES >= 100, '名单封顶不能小气到列不完小项目')
  assert.ok(AGENT_SEARCH_MAX_FILES >= 500, '搜索扫的文件数不能小气到扫不完小项目')
  assert.ok(
    AGENT_SEARCH_MAX_MATCHES >= 20 && AGENT_SEARCH_MAX_MATCHES <= 200,
    '搜索命中条数封顶得是个讲道理的数'
  )
  // 翻文件切片(逐字稿 D):教模型现在有什么手脚、只认相对路径
  assert.ok(
    AGENT_FILES_ADDENDUM.includes('当前项目用相对路径') &&
      AGENT_FILES_ADDENDUM.includes('request_directory_access'),
    '切片要交代项目内用相对路径、项目外先申请'
  )
  assert.ok(AGENT_FILES_ADDENDUM.includes('search_content'), '切片要教模型用搜索找内容')
  assert.equal(AGENT_REMINDER_MIN_TOOL_CALLS, 3, '提醒卡触发门槛:本场工具调用满 3 次才垫卡')

  // 10. 流式工具调用碎片的拼装:参数逐段续、多调用按 index 分组
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
  const [noIndex] = assembleToolCalls([
    { function: { name: 'read_file', arguments: '{"relPath":"x"}' } }
  ])
  assert.equal(noIndex.id, 'call_0', '缺 index 的当第 0 个,id 补序号')
  const [noArgs] = assembleToolCalls([{ index: 0, id: 'c', function: { name: 'list_files' } }])
  assert.equal(noArgs.args, null, '一个字参数都没给的,args 为 null 走「参数不合法」的喂回')

  // 11. 上下文自动压缩:上下文将满时旧资料变注记,近的留原样
  const longContent = 'A'.repeat(2000)
  const shortContent = 'B'.repeat(100)
  const conversation: AgentChatMessage[] = [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '帮我找东西' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"relPath":"a.ts"}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'c1', content: longContent },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c2',
          type: 'function',
          function: { name: 'read_file', arguments: '{"relPath":"b.ts"}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'c2', content: longContent },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c3',
          type: 'function',
          function: { name: 'read_file', arguments: '{"relPath":"c.ts"}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'c3', content: longContent },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c4',
          type: 'function',
          function: { name: 'read_file', arguments: '{"relPath":"d.ts"}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'c4', content: shortContent }
  ]
  const budget = agentPromptBudget(16384, 2048)
  assert.ok(
    budget >= 8000 && budget <= 20000,
    '16384 token 上下文扣完答案额度和固定预留再打八折,警戒线是个讲道理的数'
  )
  assert.equal(
    agentPromptBudget(8192, 1024),
    4096,
    '8k 档给工具表和分词误差留 2k 固定预留,别让账面没超、服务端先拒收'
  )
  assert.equal(
    compressAgentMessages(conversation, Number.MAX_SAFE_INTEGER),
    null,
    '账面没超预算:一根手指都不动'
  )
  const squeezed = compressAgentMessages(conversation, 1000)
  assert.ok(squeezed, '超了预算:要动手压缩')
  assert.equal(squeezed!.compressedCount, 2, '四条工具结果里,两条长的旧账压成注记')
  assert.deepEqual(squeezed!.freedCallIds, ['c1', 'c2'], '被压的 id 上报名单,主进程好解锁重读')
  const squeezedTools = squeezed!.messages.filter((m) => m.role === 'tool')
  assert.ok(squeezedTools[0].content.includes('占位注记'), '旧账第一条换成了注记')
  assert.ok(squeezedTools[0].content.includes('2000'), '注记注明原文约多少字')
  assert.ok(squeezedTools[1].content.includes('占位注记'), '旧账第二条同样换成注记')
  assert.equal(squeezedTools[2].content, longContent, '第一档就够时,倒数第二条留原样')
  assert.equal(squeezedTools[3].content, shortContent, '最新一条留原样')
  assert.deepEqual(squeezed!.messages[0], conversation[0], '人设不碰')
  assert.deepEqual(squeezed!.messages[1], conversation[1], '用户的提问不碰')
  assert.equal(
    squeezed!.messages.length,
    conversation.length,
    '只缩内容不动条数:tool 和 tool_calls 的对账关系不破'
  )
  // 第一档压完还不够:连倒数第二条也压掉,只留最新一条(2026-10-25 M4 挤爆案)
  const tighter = compressAgentMessages(conversation, 520)
  assert.ok(tighter, '预算更紧时仍要压')
  assert.equal(tighter!.compressedCount, 3, '第二档把倒数第二条也压成注记')
  assert.deepEqual(tighter!.freedCallIds, ['c1', 'c2', 'c3'], '被压的三条都能重读')
  const tighterTools = tighter!.messages.filter((m) => m.role === 'tool')
  assert.ok(tighterTools[2].content.includes('占位注记'), '倒数第二条不再整条占着窗口')
  assert.equal(tighterTools[3].content, shortContent, '最新一条仍留原样')
  // 最新一条自己就超大:裁成开头一截,并注明原文多长、怎么接着翻
  const hugeRecent: AgentChatMessage[] = [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '帮我找东西' },
    { role: 'tool', tool_call_id: 'c1', content: longContent },
    { role: 'tool', tool_call_id: 'c2', content: longContent },
    { role: 'tool', tool_call_id: 'c3', content: 'C'.repeat(6000) }
  ]
  const trimmed = compressAgentMessages(hugeRecent, 500)
  assert.ok(trimmed, '最新一条超大时也要压')
  const trimmedNewest = trimmed!.messages[trimmed!.messages.length - 1]
  assert.ok(
    trimmedNewest.role === 'tool' && trimmedNewest.content.includes('只带了开头一截'),
    '最新一条裁成开头一截,不留整条占满窗口'
  )
  assert.ok(
    trimmedNewest.role === 'tool' && trimmedNewest.content.includes('原文约 6000 字'),
    '裁断要照实说原文多长'
  )
  assert.ok(
    trimmedNewest.role === 'tool' && trimmedNewest.content.includes('offset'),
    '读文件的裁断要教模型怎么接着翻'
  )
  assert.ok(
    conversation[3].role === 'tool' && conversation[3].content === longContent,
    '原对话数组一个字都不动(纯函数)'
  )
  assert.equal(
    compressAgentMessages(conversation, estimateMessagesTokens(conversation)),
    null,
    '账面刚好等于预算:不压'
  )
  assert.ok(
    AGENT_KEEP_RECENT_TOOLS >= 1 && AGENT_KEEP_RECENT_TOOLS <= 4,
    '留原样的条数得是个讲道理的数'
  )
  // 中文按一字约一 token 记账:按字数除以 3 会把中文算少,长研究账面没到线、服务端已爆仓
  const cjkMessages: AgentChatMessage[] = [
    { role: 'tool', tool_call_id: 'c9', content: '中'.repeat(600) }
  ]
  assert.equal(estimateMessagesTokens(cjkMessages), 600, '600 个汉字记 600 token,不再除以 3')

  // 12. 工具能力探测的判别:只认「请求被拒 + 点名工具」的错
  assert.equal(
    looksLikeToolsUnsupported(400, '{"error":"tools is not supported by this model"}'),
    true,
    '400 + 点名 tools:不认工具'
  )
  assert.equal(
    looksLikeToolsUnsupported(422, 'Unknown parameter: function calling unavailable'),
    true,
    '422 + 点名 function:同样不认'
  )
  assert.equal(looksLikeToolsUnsupported(404, 'tool use not found'), true, '404 + 点名 tool:也认')
  assert.equal(
    looksLikeToolsUnsupported(400, 'context window exceeded'),
    false,
    '400 但跟工具无关:不冒领'
  )
  assert.equal(looksLikeToolsUnsupported(500, 'tools error'), false, '500 是服务端自己呛到:不冒领')
  assert.equal(looksLikeToolsUnsupported(200, 'tools'), false, '200 根本不是错误:不认')

  // 13. 本轮问题的提醒卡:每轮垫、垫前撤,问题原话封顶 200 字
  const reminder = buildAgentReminder('  「忙」这个字出现在哪些文件,要具体到行号  ')
  assert.ok(reminder.startsWith(AGENT_REMINDER_PREFIX), '提醒卡带固定前缀,撤卡和兜底都靠它认')
  assert.ok(reminder.includes('「忙」这个字出现在哪些文件'), '问题原话要原样引用进卡里')
  assert.ok(reminder.includes('直接收尾'), '卡尾要教模型:资料够了别再翻,直接收尾')
  assert.ok(reminder.endsWith('</program_reminder>'), '提醒卡整段包在 program_reminder 标签里(2.0)')
  const longQuestion = '问'.repeat(500)
  const clipped = buildAgentReminder(longQuestion)
  assert.ok(
    clipped.length < AGENT_REMINDER_MAX_CHARS + AGENT_REMINDER_PREFIX.length + 60,
    '超长问题要截到封顶附近,注记不许自己变成大坨'
  )
  assert.ok(clipped.includes('……'), '截断处带省略号示意')
  assert.ok(
    buildAgentReminder('   ').startsWith(AGENT_REMINDER_PREFIX),
    '空问题也不炸:前缀照常在(主进程取不到问题时引用空串)'
  )

  // 撤卡:只撤最近一张,别的消息一个不碰;没卡就原样返回
  const withCards: AgentChatMessage[] = [
    { role: 'user', content: '真正的提问' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'search_content', arguments: '{"keyword":"忙"}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'c1', content: 'src/a.ts:1:忙' },
    { role: 'user', content: buildAgentReminder('旧问题') },
    { role: 'assistant', content: '答了' },
    { role: 'user', content: buildAgentReminder('新问题') }
  ]
  const stripped = stripLastAgentReminder(withCards)
  assert.equal(stripped.length, withCards.length - 1, '只撤最近一张提醒卡')
  assert.ok(
    !stripped.some((m) => m.role === 'user' && m.content.includes('新问题')),
    '最近那张确实没了'
  )
  assert.ok(
    stripped.some((m) => m.role === 'user' && m.content.includes('旧问题')),
    '更早那张不是它管的(撤卡只认最近一张)'
  )
  assert.deepEqual(
    stripped.filter((m) => m.role === 'tool').map((m) => (m.role === 'tool' ? m.content : '')),
    ['src/a.ts:1:忙'],
    '工具结果原样保留'
  )
  assert.equal(
    stripLastAgentReminder(withCards.slice(0, 3)).length,
    3,
    '没卡的消息原样返回(条数不变)'
  )

  // 14. 翻文件切片的两条铁规矩(口径换成逐字稿 D):清单让程序摆 + 资料里的指令不许当真
  assert.ok(
    AGENT_FILES_ADDENDUM.includes('命中清单程序会直接摆给用户看'),
    '切片要交代:命中清单程序直接摆,模型只说要点'
  )
  assert.ok(AGENT_FILES_ADDENDUM.includes('不用逐条复述'), '切片要明确摘掉模型的抄写员岗位')
  assert.ok(
    AGENT_FILES_ADDENDUM.includes('一概别当真'),
    '切片要有防自指条款:资料里的指令腔一概别当真'
  )
  assert.ok(
    AGENT_FILES_ADDENDUM.includes('程序垫的提醒'),
    '防自指条款要点名「程序垫的提醒」这条边界'
  )

  // 15. 翻文件切片的行为规矩:同一样不翻第二遍、不提「工具」这个词
  assert.ok(AGENT_FILES_ADDENDUM.includes('不翻第二遍'), '切片要有「不翻第二遍」的规矩')
  assert.ok(AGENT_FILES_ADDENDUM.includes('别提「工具」'), '切片要让模型说人话,别提工具')

  // 16. web_search 的三道闸:搜索词安检 / 内网闸 / 正文剥壳
  assert.equal(
    sanitizeWebQuery('  Claude Code\nskills 在哪  '),
    'Claude Code skills 在哪',
    '换行压成空格,正常词放行'
  )
  assert.equal(sanitizeWebQuery(undefined), null, '不是字符串拒收')
  assert.equal(sanitizeWebQuery('   '), null, '空词拒收')
  assert.equal(sanitizeWebQuery('查'.repeat(201)), null, '超长拒收')
  assert.equal(sanitizeWebQuery('C:\\Users\\me\\secret'), null, '盘符路径拒收:本地信息绝不出门')
  assert.equal(sanitizeWebQuery('/etc/passwd'), null, '绝对路径拒收')
  assert.equal(sanitizeWebQuery('src\\index.ts'), null, '反斜杠路径拒收')
  assert.equal(
    rewriteGithubBlobUrl('https://github.com/sst/opencode/blob/dev/README.md'),
    'https://raw.githubusercontent.com/sst/opencode/dev/README.md',
    'GitHub 文件页改成 raw 原文'
  )
  assert.equal(
    rewriteGithubBlobUrl('https://example.com/README.md'),
    'https://example.com/README.md',
    '非 GitHub 地址原样返回'
  )
  assert.equal(
    sanitizeWebFetchUrl('https://github.com/sst/opencode/blob/dev/README.md'),
    'https://raw.githubusercontent.com/sst/opencode/dev/README.md',
    'web_fetch 安检后是 raw 地址'
  )
  assert.equal(sanitizeWebFetchUrl('http://127.0.0.1/secret'), null, '内网地址拒收')
  assert.equal(sanitizeWebFetchUrl('C:\\Users\\me\\file.md'), null, '本地路径拒收')

  assert.deepEqual(
    parseGitHubRepoUrl('https://github.com/sst/opencode'),
    { owner: 'sst', repo: 'opencode', ref: null, blobPath: null },
    '仓库首页解析出 owner/repo'
  )
  assert.deepEqual(
    parseGitHubRepoUrl('https://github.com/sst/opencode.git'),
    { owner: 'sst', repo: 'opencode', ref: null, blobPath: null },
    '.git 后缀剥掉'
  )
  assert.deepEqual(
    parseGitHubRepoUrl('https://www.github.com/sst/opencode/tree/dev/packages'),
    { owner: 'sst', repo: 'opencode', ref: 'dev', blobPath: null },
    'tree 页带上分支,子目录不当 blob'
  )
  assert.deepEqual(
    parseGitHubRepoUrl('https://github.com/sst/opencode/blob/dev/README.md'),
    { owner: 'sst', repo: 'opencode', ref: 'dev', blobPath: 'README.md' },
    'blob 页记下文件路径,打开后提示用 read_file'
  )
  assert.equal(parseGitHubRepoUrl('https://gist.github.com/foo/bar'), null, 'gist 拒收')
  assert.equal(parseGitHubRepoUrl('https://gitlab.com/foo/bar'), null, '非 github.com 拒收')
  assert.equal(parseGitHubRepoUrl('not a url'), null, '不是 URL 拒收')
  assert.equal(
    githubDisplayPath('sst', 'opencode', 'dev'),
    'github.com/sst/opencode@dev',
    '远程根展示名带分支'
  )
  assert.equal(
    githubRawFileUrl('sst', 'opencode', 'dev', 'src/a.ts'),
    'https://raw.githubusercontent.com/sst/opencode/dev/src/a.ts',
    '正文走 raw.githubusercontent.com'
  )
  assert.equal(
    githubRawFileUrl('sst', 'opencode', 'feature/foo', 'a.ts'),
    'https://raw.githubusercontent.com/sst/opencode/feature/foo/a.ts',
    '带斜杠的分支在 raw 地址里按路径段拼,不整段转义'
  )
  assert.equal(
    githubRepoKey({ owner: 'SST', repo: 'OpenCode', ref: 'dev', blobPath: null }),
    'sst/opencode@dev'
  )
  assert.deepEqual(
    parseGithubRepoMeta({
      full_name: 'sst/opencode',
      default_branch: 'dev',
      private: false
    }),
    { owner: 'sst', repo: 'opencode', defaultBranch: 'dev', private: false },
    '公开仓库元信息放行'
  )
  assert.equal(
    parseGithubRepoMeta({ full_name: 'sst/opencode', default_branch: 'dev', private: true })
      ?.private,
    true,
    '私有仓库标出来让执行手拒'
  )
  assert.equal(parseGithubRepoMeta({ default_branch: 'dev' }), null, '缺 full_name 拒收')
  const tree = parseGithubTreePayload({
    truncated: true,
    tree: [
      { path: 'README.md', type: 'blob' },
      { path: 'src', type: 'tree' },
      { path: 'src/index.ts', type: 'blob' },
      { path: 'node_modules/pkg/index.js', type: 'blob' },
      { path: 'vendor/lib', type: 'commit' },
      { path: '', type: 'blob' }
    ]
  })
  assert.ok(tree, '文件树回包能解析')
  assert.equal(tree?.truncated, true, 'GitHub 截断标记原样留下')
  assert.deepEqual(
    tree?.entries.map((e) => e.path),
    ['README.md', 'src', 'src/index.ts', 'node_modules/pkg/index.js'],
    '子模块和空路径丢掉,杂物堆留给 list 过滤器'
  )
  const ignored = new Set(['node_modules'])
  const listed = listGithubTree(tree?.entries ?? [], {
    relPath: '',
    ignored,
    maxEntries: 10,
    maxDepth: 12
  })
  assert.deepEqual(
    listed.lines,
    ['README.md', 'src/', 'src/index.ts'],
    '名单带尾斜杠,node_modules 绕开'
  )
  const srcOnly = listGithubTree(tree?.entries ?? [], {
    relPath: 'src',
    ignored,
    maxEntries: 10,
    maxDepth: 12
  })
  assert.deepEqual(srcOnly.lines, ['src/index.ts'], '子目录只列自己下面的')
  const hits = searchGithubTreePaths(tree?.entries ?? [], {
    keyword: 'index',
    relPath: '',
    ignored,
    maxHits: 20
  })
  assert.deepEqual(hits.paths, ['src/index.ts'], '路径搜索只认 blob,且绕开忽略名单')
  assert.equal(
    searchGithubTreePaths(tree?.entries ?? [], {
      keyword: '  ',
      relPath: '',
      ignored,
      maxHits: 20
    }).paths.length,
    0,
    '空关键词不搜'
  )

  assert.equal(isPublicHttpUrl('https://html.duckduckgo.com/html/?q=a'), true, '公网 https 放行')
  assert.equal(isPublicHttpUrl('http://example.com/'), true, '公网 http 放行')
  assert.equal(isPublicHttpUrl('http://localhost:5173/'), false, 'localhost 拒收')
  assert.equal(isPublicHttpUrl('http://127.0.0.1:8766/api'), false, '环回地址拒收')
  assert.equal(isPublicHttpUrl('http://192.168.1.2/'), false, '192.168 内网段拒收')
  assert.equal(isPublicHttpUrl('http://10.0.0.1/'), false, '10 内网段拒收')
  assert.equal(isPublicHttpUrl('http://172.16.5.5/'), false, '172.16 内网段拒收')
  assert.equal(isPublicHttpUrl('http://169.254.1.1/'), false, '链路本地拒收')
  assert.equal(isPublicHttpUrl('http://[::1]/'), false, 'IPv6 环回拒收')
  assert.equal(isPublicHttpUrl('ftp://example.com/file'), false, '非 http(s) 协议拒收')
  assert.equal(isPublicHttpUrl('file:///C:/secret'), false, 'file 协议拒收')
  assert.equal(isPublicHttpUrl('not a url'), false, '不是 URL 拒收')

  const page = htmlToText(
    '<html><head><title>外壳</title><style>.x{}</style></head><body><script>evil()</script><p>正文第一段</p>  <b>加粗</b> &amp; 尾巴</body></html>'
  )
  assert.ok(page.includes('正文第一段'), '正文要留下来')
  assert.ok(page.includes('&') && page.includes('尾巴'), '实体解码、正文连续')
  assert.ok(!page.includes('evil'), 'script 整块剥掉')
  assert.ok(!page.includes('<p>') && !page.includes('<b>'), '标签剥干净')
  assert.ok(!page.includes('外壳'), 'head 整块剥掉')

  assert.equal(
    WEB_SEARCH_PAGE_COUNT,
    1,
    'web_search 默认只抓一条正文:摘要清单为主,别让大段正文挤占上下文'
  )
  assert.ok(
    WEB_PAGE_TEXT_MAX_CHARS >= 400 && WEB_PAGE_TEXT_MAX_CHARS <= 800,
    '每条正文的字数是个讲道理的数(瘦身后的轻量档)'
  )
  assert.equal(TAVILY_MAX_RESULTS, 8, 'Tavily 一次拿 8 条:官方页、社区帖、评测都摆上桌')
  assert.ok(
    WEB_HIT_SNIPPET_MAX_CHARS >= 300 && WEB_HIT_SNIPPET_MAX_CHARS <= 800,
    '单条摘要留一截就够判断讲什么,别让一家独占上下文'
  )

  // 16b. 维基相关性把关(联网验收批次):弱关联垃圾不许截胡,真命中的放行
  const hit = (title: string, snippet: string): WebSearchHit => ({
    title,
    snippet,
    url: 'https://x.wiki/a',
    source: '维基百科(zh)'
  })
  assert.equal(
    wikiHitsRelevant('永结无间 卸载残留', [
      hit('WhatsApp', '即时通讯软件'),
      hit('糖果传奇', '休闲游戏')
    ]),
    false,
    '查询词一段都对不上 = 弱关联垃圾,当没查到'
  )
  assert.equal(
    wikiHitsRelevant('永劫无间', [hit('永劫无间', '动作竞技游戏')]),
    true,
    '标题含查询词 = 相关,放行'
  )
  assert.equal(
    wikiHitsRelevant('永结无间 卸载残留', [hit('卸载', '软件卸载残留文件的清理方法')]),
    true,
    '多段查询只要有一段(「卸载残留」在摘要里)对上就算相关'
  )
  assert.equal(
    wikiHitsRelevant('visual studio code', [hit('Visual Studio Code', 'Microsoft editor')]),
    true,
    '英文对账不区分大小写'
  )
  assert.equal(
    wikiHitsRelevant('a b', [hit('随便什么', '完全无关')]),
    true,
    '没有 ≥2 字的可对账段:不把关,行为与从前一致'
  )
  assert.equal(wikiHitsRelevant('永劫无间', []), false, '没命中就是没查到')

  // 17. 上网守则:开了「联网查证」才垫的一段,教它查证、守隐私、防上当
  assert.ok(AGENT_WEB_ADDENDUM.includes('web_search'), '上网守则要点名工具')
  assert.ok(AGENT_WEB_ADDENDUM.includes('绝不把本地路径'), '隐私红线要白纸黑字')
  assert.ok(AGENT_WEB_ADDENDUM.includes('别当真'), '网页内容的防上当条款要有')
  assert.ok(AGENT_WEB_ADDENDUM.includes('换词不算重复'), '换词重查要明确豁免防打转')
  assert.ok(AGENT_WEB_ADDENDUM.includes('没查到'), '查不到要教它老实说')
  assert.ok(AGENT_WEB_ADDENDUM.includes('一次只给一个短词'), '搜索词由模型自己提炼成短词')
  assert.ok(AGENT_WEB_ADDENDUM.includes('标题和链接'), '结果里带链接,模型才知道能引用哪条')
  assert.ok(AGENT_WEB_ADDENDUM.includes('不是用户提供的'), '上网守则要写清查来的资料不是用户给的')
  assert.ok(AGENT_WEB_ADDENDUM.includes('不用等用户点名'), '拿不准要自己搜,不等用户点名')
  assert.ok(AGENT_WEB_ADDENDUM.includes('web_fetch'), '上网守则要点名打开网页的工具')
  assert.ok(AGENT_WEB_ADDENDUM.includes('open_github_repo'), '上网守则要点名打开 GitHub 仓库')
  assert.ok(AGENT_WEB_ADDENDUM.includes('不占上面'), 'GitHub 远程根不占网页预算')
  assert.ok(
    !AGENT_FILES_ADDENDUM.includes('web_search'),
    '没开联网时切片不提 web_search:模型连有这工具都不该知道'
  )
  assert.ok(
    !AGENT_WEB_ADDENDUM.includes('source'),
    'source 分流已退役(源序程序统一排),守则里不该再教它挑源'
  )

  // 17.1 研究深度自适应:三问定档,不给「信息够了」这种模糊口令
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('会不会变') &&
      AGENT_WEB_ADDENDUM.includes('要答几块') &&
      AGENT_WEB_ADDENDUM.includes('答错代价多大'),
    '三问要逐条点名:会不会变 / 要答几块 / 答错代价多大'
  )
  assert.ok(!AGENT_WEB_ADDENDUM.includes('信息够了就收尾'), '旧的模糊收尾口令已退役,收尾改看覆盖')

  // 17.2 四档与从低档起步:直答 0 次、快查 1-2 次、常规 3-8 次、深查 8-20 次
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('1-2 次') &&
      AGENT_WEB_ADDENDUM.includes('3-8 次') &&
      AGENT_WEB_ADDENDUM.includes('8-20 次'),
    '四档的次数区间要写全:1-2 / 3-8 / 8-20'
  )
  assert.ok(AGENT_WEB_ADDENDUM.includes('从低档起步'), '够用就停,不够再升,不许一上来铺最大')
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('防止无界搜索的硬上限') &&
      AGENT_WEB_ADDENDUM.includes(`最多 ${AGENT_WEB_MAX_LOOKUPS} 次`),
    '20 次要说清是防无界搜索的硬上限,不是任务指标'
  )
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('三个问题一起看') &&
      AGENT_WEB_ADDENDUM.includes('任何一条要求搜就搜') &&
      AGENT_WEB_ADDENDUM.includes('别因为觉得知识稳定'),
    '三问要一起看:任何一条要求搜就搜,不能因知识稳定跳过对比/研究/来源题'
  )

  // 17.3 具体事实必须落到正文,不能只信摘要
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('涉及具体数字、版本、政策、对比') &&
      AGENT_WEB_ADDENDUM.includes('打开正文核对') &&
      AGENT_WEB_ADDENDUM.includes('不能只信摘要'),
    '具体数字/版本/政策/对比必须打开正文核对'
  )

  // 17.4 收尾看覆盖:逐条对结论、排除备选、两轮无新增即收、缺失如实说
  assert.ok(AGENT_WEB_ADDENDUM.includes('收尾不看次数'), '收尾看覆盖,不看搜了几次')
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('每个关键结论都要有资料撑着'),
    '写答案前逐条对照,关键结论都要有出处'
  )
  assert.ok(AGENT_WEB_ADDENDUM.includes('用搜索排除不对的'), '多个可能答案时要用搜索证伪')
  assert.ok(AGENT_WEB_ADDENDUM.includes('连续两轮没有新东西'), '两轮无新增就收尾,别打转')
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('没搜到') &&
      AGENT_WEB_ADDENDUM.includes('不等于') &&
      AGENT_WEB_ADDENDUM.includes('不存在'),
    '没搜到不等于不存在,不许把推测说成事实'
  )

  // 17.5 来源质量:原始来源优先,论坛和聚合站只作旁证
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('官方站、原始文档、GitHub、论文/政府/公司公告'),
    '原始来源要逐类点名'
  )
  assert.ok(AGENT_WEB_ADDENDUM.includes('论坛和聚合站只作旁证'), '论坛不能和官方站并列')
  assert.ok(!AGENT_WEB_ADDENDUM.includes('Reddit、知乎'), '论坛不再作为优先来源推荐')

  // 17.6 高风险问题:两个独立来源或一个权威原始来源
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('两个独立来源或一个权威原始来源'),
    '高风险问题要抬高来源门槛'
  )
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('具体剂量') &&
      AGENT_WEB_ADDENDUM.includes('法律条款') &&
      AGENT_WEB_ADDENDUM.includes('买卖决定') &&
      AGENT_WEB_ADDENDUM.includes('安全操作') &&
      AGENT_WEB_ADDENDUM.includes('不可逆动作'),
    '高风险场景要逐类点名'
  )
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('不可逆动作,必须先搜'),
    '高风险问题要先搜再答,不能凭记忆下结论'
  )

  // 17.7 研究计划表:首轮先填字段,程序按填表对账
  assert.ok(AGENT_WEB_ADDENDUM.includes('plan_research'), '守则要教它在开头填研究计划表')
  for (const field of [
    'parts',
    'mayChange',
    'stakesHigh',
    'asksSources',
    'aboutProject',
    'depth'
  ]) {
    assert.ok(AGENT_WEB_ADDENDUM.includes(field), `计划表字段 ${field} 要逐项写清`)
  }
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('SQLite、DuckDB、ClickHouse') &&
      AGENT_WEB_ADDENDUM.includes('list 和 tuple'),
    '对比题与直答题要有一对例子,帮小模型分清 parts'
  )
  assert.ok(
    AGENT_WEB_ADDENDUM.includes('程序按你填的定最低查证量') &&
      AGENT_WEB_ADDENDUM.includes('没到数会请你补'),
    '要告诉模型:程序按它填的表对账,没查够会被请回去补'
  )
  assert.ok(AGENT_WEB_ADDENDUM.includes('原样打开'), '用户给的地址不改写,直接打开')

  // 18. Tavily 响应解析(2026-09-17 接 Tavily 打头):洗成搜索命中,脏数据一律跳过
  const tavilyOk = parseTavilyResults(
    JSON.stringify({
      results: [
        {
          title: 'AOMEI <b>Backup</b>',
          url: 'https://www.aomei.com/',
          content: 'backup &amp; restore software',
          published_date: '2026-10-01'
        },
        { title: '', url: 'https://no-title.example/' },
        { title: '缺链接', url: '   ' },
        '垃圾行',
        { title: '第三条', url: 'https://example.com/3', content: '' }
      ]
    })
  )
  assert.equal(tavilyOk.length, 2, '缺标题/缺链接/垃圾行都跳过,只收干净命中')
  assert.equal(tavilyOk[0]?.title, 'AOMEI Backup', '标题的 HTML 标记剥干净')
  assert.equal(tavilyOk[0]?.snippet, 'backup & restore software', '摘要剥 HTML 实体')
  assert.equal(tavilyOk[0]?.source, 'Tavily', '来源记账是 Tavily')
  assert.equal(tavilyOk[0]?.published, '2026-10-01', '发布时间源给了就带上')
  assert.deepEqual(parseTavilyResults('不是 JSON'), [], '坏 JSON = 空清单,让兜底链接着走')
  assert.deepEqual(parseTavilyResults('{"results": null}'), [], 'results 缺失 = 空清单')

  // 18c. 喂给模型的材料要带链接和发布时间(模型能判断来源、能引用)
  const material = await webSearchDetailed('selftest-web-material-2026', {
    tavilyKey: 'tvly-selftest',
    postJson: async () =>
      JSON.stringify({
        results: [
          {
            title: '官方 Go 套餐',
            url: 'https://opencode.ai/zh/go',
            content: '每月 10 美元,包含一批开放模型。',
            published_date: '2026-10-01'
          }
        ]
      }),
    fetchText: async () => '<html><body><p>正文第一段</p></body></html>'
  })
  assert.equal(material.hits.length, 1, '命中清单留在结果里,给质检闸对账')
  assert.ok(
    material.material.includes('[官方 Go 套餐](https://opencode.ai/zh/go)'),
    '每条结果都要带可点链接'
  )
  assert.ok(material.material.includes('2026-10-01'), '发布时间要带上,判断新鲜度用')
  assert.ok(material.material.includes('正文第一段'), '第一条正文节选照旧垫底')

  // 19. 紧急瘦身(压缩那案的兜底):上下文溢出时整段裁旧账,只保 system 和最新真问题
  const fat: AgentChatMessage[] = [
    { role: 'system', content: '人设' },
    { role: 'user', content: '旧问题一' },
    { role: 'assistant', content: '旧答案一' },
    { role: 'user', content: '旧问题二' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"relPath":"a.ts"}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'c1', content: '文件内容一大坨' },
    { role: 'user', content: buildAgentReminder('旧问题二') },
    { role: 'user', content: '最新的真问题' }
  ]
  const slimmed = emergencySlim(fat)
  assert.ok(slimmed, '肥对话要裁得动')
  assert.equal(slimmed!.dropped, 6, '真问题之前的 6 条旧账全清')
  assert.deepEqual(
    slimmed!.messages.map((m) => m.role),
    ['system', 'user'],
    '只剩 system 和最新真问题:assistant/tool 的成对关系整段一起走,协议不破'
  )
  assert.equal(
    (slimmed!.messages[1] as { content: string }).content,
    '最新的真问题',
    '保住的是最新的真问题'
  )
  assert.ok(
    fat[1] && 'content' in fat[1] && fat[1].content === '旧问题一',
    '原数组一个字不动(纯函数)'
  )
  const onlyQuestion: AgentChatMessage[] = [
    { role: 'system', content: '人设' },
    { role: 'user', content: '唯一的问题' }
  ]
  assert.equal(emergencySlim(onlyQuestion), null, '前面没有可裁的旧账:返回 null 照实报错,不硬撑')
  const noSystem: AgentChatMessage[] = [
    { role: 'user', content: '旧问题' },
    { role: 'user', content: '新问题' }
  ]
  const slimmedNoSystem = emergencySlim(noSystem)
  assert.ok(
    slimmedNoSystem &&
      slimmedNoSystem.messages.length === 1 &&
      slimmedNoSystem.messages[0].role === 'user',
    '没有 system 也照裁:不硬造 system'
  )
  // 研究账本是程序插话,不能当成「最新真问题」把真问题裁掉
  const withLedger: AgentChatMessage[] = [
    { role: 'system', content: '人设' },
    { role: 'user', content: '旧问题' },
    { role: 'user', content: `${AGENT_RESEARCH_PREFIX}\n- 搜索「x」:事实` },
    { role: 'user', content: '最新真问题' }
  ]
  assert.equal(
    (emergencySlim(withLedger)?.messages[1] as { content: string }).content,
    '最新真问题',
    '研究账本不能冒充真问题'
  )
  // 补查闸门也是程序插话:爆仓瘦身时同样不许顶替真问题
  const withGateNudge: AgentChatMessage[] = [
    { role: 'system', content: '人设' },
    { role: 'user', content: '旧问题' },
    { role: 'user', content: buildResearchGateNudge(['联网 0/3 次']) },
    { role: 'user', content: '最新真问题' }
  ]
  assert.equal(
    (emergencySlim(withGateNudge)?.messages[1] as { content: string }).content,
    '最新真问题',
    '研究补查令不能冒充真问题'
  )
  // 翻文件模式的工具往来都在真问题之后,同样算旧账:只保问题,让模型拿着问题重新翻
  const agentFat: AgentChatMessage[] = [
    { role: 'system', content: '人设' },
    { role: 'user', content: '最新的真问题' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"relPath":"a.ts"}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'c1', content: '文件内容一大坨' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c2',
          type: 'function',
          function: { name: 'read_file', arguments: '{"relPath":"b.ts"}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'c2', content: '又一大坨' }
  ]
  const slimmedAgent = emergencySlim(agentFat)
  assert.ok(slimmedAgent, '翻文件模式也要裁得动:工具往来都在真问题之后')
  assert.equal(slimmedAgent!.dropped, 4, '真问题之后的四段工具往来整段走')
  assert.deepEqual(
    slimmedAgent!.messages.map((m) => m.role),
    ['system', 'user'],
    '只剩 system 和真问题:tool_calls 与 tool 成对一起走,协议不破'
  )

  // 21. 翻文件切片的指路分工 + 工具说明瘦身后的口径(逐字稿 D/L)
  // 旧 SOP 段落(固定三步走/验货)随新稿退役:切片现在按「想干什么 → 用哪个工具」分工,
  // 找位置必须搜到具体文件的验收判据并进 search_content 那一条
  assert.ok(
    AGENT_FILES_ADDENDUM.includes('→ list_files') &&
      AGENT_FILES_ADDENDUM.includes('→ read_file') &&
      AGENT_FILES_ADDENDUM.includes('→ search_content'),
    '切片要按「想干什么 → 用哪个工具」分工'
  )
  assert.ok(
    AGENT_FILES_ADDENDUM.includes('搜到具体文件才算数'),
    '找位置的验收判据还在:必须搜到具体文件'
  )
  assert.ok(
    !AGENT_FILES_ADDENDUM.includes('web_search'),
    '切片照旧不提 web_search:没开联网时模型不该知道'
  )
  assert.ok(
    searchTool.function.description.includes('文件路径和文件内容都算'),
    'search_content 说明要点明文件路径也搜'
  )
  assert.ok(searchTool.function.description.includes('长句搜不到'), '说明里把「长句搜不到」写死')
  assert.ok(
    AGENT_SEARCH_MAX_PATH_HITS >= 5 && AGENT_SEARCH_MAX_PATH_HITS <= 50,
    '路径命中封顶是个讲道理的数,不许一窝蜂挤掉内容命中'
  )

  // 22. 黑名单引擎的兜底拼装(补洞):翻文件开着但引擎不会工具调用时,
  // 起手不挂切片、中途摘除切片,都要补一段「没手脚」切片 —— 不然人设里什么能力声明
  // 都没剩,模型会照旧吹自己翻过项目
  const agentBase = buildChatSystem({ agent: true })
  assert.ok(
    !agentBase.includes(SLICE_NO_TOOLS),
    '翻文件开着时底座不含无工具切片:切片是 agent 路自己追加的'
  )
  const blacklistedSystem = `${agentBase}\n\n${SLICE_NO_TOOLS}`
  assert.ok(
    blacklistedSystem.includes('没有翻文件能力'),
    '黑名单引擎的人设要明说本轮没有翻文件能力'
  )
  assert.ok(blacklistedSystem.includes('翻文件开关'), '要指路输入框旁的翻文件开关')
  assert.ok(SLICE_NO_TOOLS.includes('闲聊'), '没翻文件时闲聊直接答,别拦着要开项目')

  // 22b. 没开项目不走翻文件循环:开关只表示给过这能力,没有文件可翻就当普通对话
  assert.equal(
    agentOnThisRound({ agent: true, imageCount: 0, rootPath: '/proj' }),
    true,
    '开着翻文件且有项目根才走循环'
  )
  assert.equal(
    agentOnThisRound({ agent: true, imageCount: 0, rootPath: '' }),
    false,
    '没开项目不当翻文件,也不报错'
  )
  assert.equal(
    agentOnThisRound({ agent: true, imageCount: 0, rootPath: undefined }),
    false,
    '没带项目根不当翻文件'
  )
  assert.equal(
    agentOnThisRound({ agent: true, imageCount: 1, rootPath: '/proj' }),
    false,
    '带图这一轮没有翻文件'
  )
  assert.equal(
    agentOnThisRound({ agent: false, imageCount: 0, rootPath: '/proj' }),
    false,
    '开关关着不走循环'
  )

  // 23. 流式轮次的封板令:边说边喊工具时,已吐的话封口保留
  // 假模型服务按问题里的 mode 出三种牌:talk = 纯说话;work = 先说话再喊工具;
  // silent = 一个字不说直接喊工具。验证:work 发封板令不发回滚,另外两种都不发
  let planRequestBody = ''
  const sealServer = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => {
      body += c.toString('utf8')
    })
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (body.includes('mode=talk')) {
        res.write('data: {"choices":[{"delta":{"content":"直接答你"}}]}\n\n')
      } else if (body.includes('mode=plan')) {
        planRequestBody = body
        res.write(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_plan","type":"function","function":{"name":"plan_research","arguments":"{\\"parts\\":[\\"SQLite\\"],\\"mayChange\\":true,\\"stakesHigh\\":false,\\"asksSources\\":false,\\"aboutProject\\":false,\\"depth\\":\\"quick\\"}"}}]}}]}\n\n'
        )
      } else if (body.includes('mode=repeat')) {
        res.write(
          'data: {"choices":[{"delta":{"content":"已经答对的正文。重复尾巴内容重复尾巴内容重复尾巴内容重复尾巴内容"}}]}\n\n'
        )
      } else if (body.includes('mode=silent')) {
        res.write(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_files","arguments":"{\\"relPath\\":\\"src\\"}"}}]}}]}\n\n'
        )
      } else {
        res.write('data: {"choices":[{"delta":{"content":"我先看看 src 目录"}}]}\n\n')
        res.write(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_files","arguments":"{\\"relPath\\":\\"src\\"}"}}]}}]}\n\n'
        )
      }
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => sealServer.listen(0, '127.0.0.1', resolve))
  const sealAddr = sealServer.address()
  assert.ok(sealAddr && typeof sealAddr === 'object', '封板假服务要监听上端口')
  const sealTarget = { baseUrl: `http://127.0.0.1:${sealAddr.port}/v1`, model: 'fake' }
  try {
    // 边说边干活:吐了正经话再喊工具 → 发 seal,话留着,绝不许发 reset 抹掉
    const workEvents: AgentStreamEvent[] = []
    const work = await agentRound(sealTarget, [{ role: 'user', content: 'mode=work' }], {
      maxTokens: 200,
      useTools: true,
      onDelta: (ev) => workEvents.push(ev)
    })
    assert.equal(work.status, 'ok', '边说边干活轮应正常收工')
    assert.ok(
      work.status === 'ok' && work.raw.tool_calls?.[0]?.function.name === 'list_files',
      '工具调用照样收进来'
    )
    assert.ok(
      work.status === 'ok' && work.raw.content === '我先看看 src 目录',
      '说出口的话回填进消息'
    )
    assert.ok(
      workEvents.some((ev) => ev.seal),
      '说了话又喊工具:要发封板令'
    )
    assert.ok(!workEvents.some((ev) => ev.reset), '正经话不许发回滚令抹掉')

    // 纯说话:没喊工具 → 什么令都不发
    const talkEvents: AgentStreamEvent[] = []
    const talk = await agentRound(sealTarget, [{ role: 'user', content: 'mode=talk' }], {
      maxTokens: 200,
      useTools: true,
      onDelta: (ev) => talkEvents.push(ev)
    })
    assert.equal(talk.status, 'ok', '纯说话轮应正常收工')
    assert.ok(talk.status === 'ok' && !talk.raw.tool_calls, '纯说话没有工具调用')
    assert.ok(!talkEvents.some((ev) => ev.seal || ev.reset), '没喊工具:封板/回滚都不发')

    // 哑巴喊工具:一个字没说 → 没话可封,不发令
    const silentEvents: AgentStreamEvent[] = []
    const silent = await agentRound(sealTarget, [{ role: 'user', content: 'mode=silent' }], {
      maxTokens: 200,
      useTools: true,
      onDelta: (ev) => silentEvents.push(ev)
    })
    assert.equal(silent.status, 'ok', '哑巴轮应正常收工')
    assert.ok(silent.status === 'ok' && silent.raw.content === null, '没说话正文就是 null')
    assert.ok(!silentEvents.some((ev) => ev.seal), '没吐正经字:没啥可封,不发令')

    // 正文吐过之后打转:只截尾巴,绝不许发回滚令把已经说对的部分抹掉
    const repeatEvents: AgentStreamEvent[] = []
    const repeat = await agentRound(sealTarget, [{ role: 'user', content: 'mode=repeat' }], {
      maxTokens: 200,
      useTools: true,
      onDelta: (ev) => repeatEvents.push(ev)
    })
    assert.equal(repeat.status, 'repetition', '打转轮要如实回报')
    assert.ok(
      repeat.status === 'repetition' && repeat.bodyStarted === true,
      '打转前已经吐过正文,要标记 bodyStarted'
    )
    assert.ok(!repeatEvents.some((ev) => ev.reset), '吐过正文后打转也不许整段撤回')

    // 首轮强制计划:请求里只许出现 plan_research,且点名必须调用
    const planRound = await agentRound(sealTarget, [{ role: 'user', content: 'mode=plan' }], {
      maxTokens: 200,
      useTools: true,
      forcePlan: true
    })
    assert.equal(planRound.status, 'ok', '强制计划轮应正常收工')
    assert.ok(planRequestBody.includes('"plan_research"'), '强制计划轮只亮计划表工具')
    assert.ok(planRequestBody.includes('"tool_choice":"required"'), '强制计划轮要求必须调用')
    assert.ok(!planRequestBody.includes('"list_files"'), '强制计划轮不夹带常驻工具')
    assert.ok(
      planRound.status === 'ok' && planRound.raw.tool_calls?.[0]?.function.name === 'plan_research',
      '计划调用要能拼回来'
    )
  } finally {
    await new Promise<void>((resolve) => sealServer.close(() => resolve()))
  }

  // 24. 研究计划表:模型自己填字段,程序只执行它报的数,交卷前按规定对账
  const planM0 = parseResearchPlan({
    parts: [],
    mayChange: false,
    stakesHigh: false,
    asksSources: false,
    aboutProject: true,
    depth: 'none'
  })
  assert.ok(planM0, '计划表要能解析')
  assert.deepEqual(
    floorFromPlan(planM0),
    { depth: 'none', lookups: 0, fetches: 0, local: 1 },
    '问项目:先翻本地文件,不许拿记忆冒充'
  )

  const planM1 = parseResearchPlan({
    parts: [],
    mayChange: false,
    stakesHigh: false,
    asksSources: false,
    aboutProject: false,
    depth: 'none'
  })
  assert.ok(planM1)
  assert.deepEqual(
    floorFromPlan(planM1),
    { depth: 'none', lookups: 0, fetches: 0, local: 0 },
    '稳定知识直答:一次也不许逼它搜'
  )

  const planM2 = parseResearchPlan({
    parts: [],
    mayChange: true,
    stakesHigh: false,
    asksSources: false,
    aboutProject: false,
    depth: 'quick'
  })
  assert.ok(planM2)
  assert.deepEqual(
    floorFromPlan(planM2),
    { depth: 'quick', lookups: 2, fetches: 1, local: 0 },
    '单一当前事实:快查并打开一次正文,合计落进 1-2 次'
  )

  const planM3 = parseResearchPlan({
    parts: ['SQLite', 'DuckDB', 'ClickHouse'],
    mayChange: true,
    stakesHigh: false,
    asksSources: false,
    aboutProject: false,
    depth: 'quick'
  })
  assert.ok(planM3)
  assert.deepEqual(
    floorFromPlan(planM3),
    { depth: 'normal', lookups: 3, fetches: 1, local: 0 },
    '多对象对比:模型报快查也要升到常规,每个对象至少一次'
  )

  const planM5 = parseResearchPlan({
    parts: [],
    mayChange: false,
    stakesHigh: true,
    asksSources: false,
    aboutProject: false,
    depth: 'none'
  })
  assert.ok(planM5)
  assert.deepEqual(
    floorFromPlan(planM5),
    { depth: 'quick', lookups: 2, fetches: 1, local: 0 },
    '法律/高风险:报直答也要先搜并打开原文'
  )

  const planM8 = parseResearchPlan({
    parts: ['React', 'Vue', 'Angular', 'Svelte'],
    mayChange: true,
    stakesHigh: false,
    asksSources: true,
    aboutProject: false,
    depth: 'normal'
  })
  assert.ok(planM8)
  assert.deepEqual(
    floorFromPlan(planM8),
    { depth: 'deep', lookups: 8, fetches: 2, local: 0 },
    '要来源又拆出多块:报常规也按深查准备,修 M8 深度'
  )

  const dirtyPlan = parseResearchPlan({
    parts: [' A ', '', 'A', 'B', 3],
    mayChange: 'yes',
    stakesHigh: 1,
    asksSources: true,
    aboutProject: false,
    depth: 'bogus'
  })
  assert.ok(dirtyPlan)
  assert.deepEqual(dirtyPlan.parts, ['A', 'B'], 'parts 去空去重,非字符串丢掉')
  assert.equal(dirtyPlan.mayChange, false, '字符串 yes 不算真布尔')
  assert.equal(dirtyPlan.stakesHigh, false, '数字 1 不算真布尔')
  assert.equal(dirtyPlan.depth, 'none', '不认识的档位按直答收')
  assert.equal(parseResearchPlan(null), null, '参数读不出就明说读不懂')

  const m3Floor = floorFromPlan(planM3)
  assert.deepEqual(
    unmetResearchFloor(m3Floor, { lookups: 1, fetches: 0, local: 0 }),
    ['联网 1/3 次', '打开原文 0/1 次'],
    '缺口按账本实数报'
  )
  assert.deepEqual(
    unmetResearchFloor(m3Floor, { lookups: 3, fetches: 1, local: 0 }),
    [],
    '达标就没有缺口'
  )

  const m8Floor = floorFromPlan(planM8)
  assert.equal(
    shouldGateAnswer({
      floor: m8Floor,
      counts: { lookups: 2, fetches: 0, local: 0 },
      nudges: 0,
      hasNewProgress: true,
      toolsAvailable: true,
      webBudgetLeft: true
    }),
    true,
    '没查够:打回去补查,不急着交卷'
  )
  assert.equal(
    shouldGateAnswer({
      floor: m8Floor,
      counts: { lookups: 2, fetches: 0, local: 0 },
      nudges: RESEARCH_GATE_MAX_NUDGES,
      hasNewProgress: true,
      toolsAvailable: true,
      webBudgetLeft: true
    }),
    false,
    '劝到上限就放行,不能死循环'
  )
  assert.equal(
    shouldGateAnswer({
      floor: m8Floor,
      counts: { lookups: 2, fetches: 0, local: 0 },
      nudges: 1,
      hasNewProgress: false,
      toolsAvailable: true,
      webBudgetLeft: true
    }),
    false,
    '上一劝之后没动手:放行,不空转'
  )
  assert.equal(
    shouldGateAnswer({
      floor: m8Floor,
      counts: { lookups: 2, fetches: 0, local: 0 },
      nudges: 0,
      hasNewProgress: true,
      toolsAvailable: true,
      webBudgetLeft: false
    }),
    false,
    '联网预算烧完:放行,让它用手头资料收尾'
  )
  assert.equal(
    shouldGateAnswer({
      floor: floorFromPlan(planM0),
      counts: { lookups: 0, fetches: 0, local: 0 },
      nudges: 0,
      hasNewProgress: true,
      toolsAvailable: true,
      webBudgetLeft: false
    }),
    true,
    '问项目且没翻本地:跟联网预算无关,照样要求先翻'
  )
  assert.equal(
    shouldGateAnswer({
      floor: floorFromPlan(planM1),
      counts: { lookups: 0, fetches: 0, local: 0 },
      nudges: 0,
      hasNewProgress: true,
      toolsAvailable: true,
      webBudgetLeft: true
    }),
    false,
    '直答档没有缺口:不拦'
  )
  assert.equal(
    shouldGateAnswer({
      floor: m8Floor,
      counts: { lookups: 2, fetches: 0, local: 0 },
      nudges: 0,
      hasNewProgress: true,
      toolsAvailable: false,
      webBudgetLeft: true
    }),
    false,
    '工具已经撤了:放行,不能让它无路可走'
  )

  const gateNudge = buildResearchGateNudge(['联网 1/3 次', '打开原文 0/1 次'])
  assert.ok(gateNudge.startsWith(AGENT_RESEARCH_GATE_PREFIX), '补查令带固定前缀,瘦身时认得出')
  assert.ok(gateNudge.includes('联网 1/3 次'), '差多少要写清楚')
  assert.ok(gateNudge.includes('先按计划补查再交卷'), '明确要求先查再答')

  const planOutcome = runResearchPlanCall({
    parts: ['SQLite', 'DuckDB', 'ClickHouse'],
    mayChange: true,
    stakesHigh: false,
    asksSources: false,
    aboutProject: false,
    depth: 'quick'
  })
  assert.ok(planOutcome.floor, '正常计划要算出下限')
  assert.ok(planOutcome.content.includes('联网至少 3 次'), '工具结果要把程序下限告诉模型')
  assert.ok(planOutcome.content.includes('SQLite'), '对象清单回给模型,照着查')
  assert.ok(planOutcome.step.includes('常规'), '界面灰字要报升上来的档位')
  const unreadablePlan = runResearchPlanCall(null)
  assert.equal(unreadablePlan.floor, null, '读不懂计划表就不设下限,不硬造')
  assert.ok(unreadablePlan.content.includes('没读懂'), '读不懂要明说')

  assert.equal(PLAN_RESEARCH_TOOL.function.name, 'plan_research', '计划表登记名叫 plan_research')
  assert.deepEqual(
    [...PLAN_RESEARCH_TOOL.function.parameters.required],
    ['parts', 'mayChange', 'stakesHigh', 'asksSources', 'aboutProject', 'depth'],
    '六项字段全部必填'
  )
  assert.ok(
    !AGENT_TOOLS.some((tool) => tool.function.name === 'plan_research'),
    '计划表只在首轮临时给,不进常驻工具表'
  )

  // 24.1 爆仓判定认服务端原文:人话翻译把英文特征词盖掉了,不能因此跳过紧急瘦身
  const overflowMessages: AgentChatMessage[] = [
    { role: 'system', content: '人设' },
    { role: 'user', content: '最新真问题' },
    { role: 'user', content: `${AGENT_REMINDER_PREFIX}最新真问题` },
    { role: 'tool', tool_call_id: 'call_1', content: '早先的资料' }
  ]
  const overflowFlags = {
    repetitionRetried: false,
    reminderFailsafe: false,
    slimRetried: false,
    cutCallRetried: false,
    skipNudgeOnce: false
  }
  const overflowDecision = handleAgentFailure({
    round: {
      status: 'error',
      text: '材料塞不下模型的脑容量了:清点一下参考材料,或去设置里调大「模型上下文」',
      detail: 'the request exceeds the available context size, try increasing it',
      httpStatus: 400
    },
    messages: overflowMessages,
    addendum: '',
    useTools: true,
    engineNoTools: false,
    flags: overflowFlags,
    doneCalls: new Set<string>(),
    callIdToKey: new Map<string, string>()
  })
  assert.equal(overflowDecision.kind, 'retry', '爆仓要重试')
  assert.ok(
    overflowDecision.kind === 'retry' && overflowDecision.step.includes('脑容量'),
    '爆仓走紧急瘦身,不能被提示词翻译成中文就漏判'
  )
  assert.equal(overflowFlags.reminderFailsafe, false, '爆仓不许消耗提醒卡兜底的那次机会')
  assert.deepEqual(
    overflowMessages,
    [
      { role: 'system', content: '人设' },
      { role: 'user', content: '最新真问题' }
    ],
    '爆仓瘦身只保 system 和最新真问题'
  )

  // 24.2 工具调用被截断:500 + 参数解析失败 → 压一轮重试,只兜一次
  assert.equal(
    isCutToolCall({
      status: 'error',
      text: '模型服务返回错误(500):模型服务出错了',
      detail:
        '{"error":{"code":500,"message":"Failed to parse tool call arguments as JSON: parse error"}}',
      httpStatus: 500
    }),
    true,
    '500 + 参数解析失败认作工具调用被截断'
  )
  assert.equal(
    isCutToolCall({
      status: 'error',
      text: '服务炸了',
      detail: 'internal server error',
      httpStatus: 500
    }),
    false,
    '普通 500 不冒领成工具截断'
  )
  const cutFlags = {
    repetitionRetried: false,
    reminderFailsafe: false,
    slimRetried: false,
    cutCallRetried: false,
    skipNudgeOnce: false
  }
  const cutMessages: AgentChatMessage[] = [
    { role: 'system', content: '人设' },
    { role: 'user', content: '最新真问题' }
  ]
  const cutDecision = handleAgentFailure({
    round: {
      status: 'error',
      text: '模型服务返回错误(500):模型服务出错了',
      detail: 'Failed to parse tool call arguments as JSON: unexpected end of input',
      httpStatus: 500
    },
    messages: cutMessages,
    addendum: '',
    useTools: true,
    engineNoTools: false,
    flags: cutFlags,
    doneCalls: new Set<string>(),
    callIdToKey: new Map<string, string>()
  })
  assert.equal(cutDecision.kind, 'retry', '工具调用被截断要压短重试')
  assert.ok(
    cutDecision.kind === 'retry' && cutDecision.step.includes('截断'),
    '重试灰字说明是工具调用被截断'
  )
  assert.equal(cutFlags.cutCallRetried, true, '截断兜底只兜一次')

  // 普通 4xx 仍走提醒卡兜底:撤卡重答,不误判成爆仓
  const reminderMessages: AgentChatMessage[] = [
    { role: 'system', content: '人设' },
    { role: 'user', content: '最新真问题' },
    { role: 'user', content: `${AGENT_REMINDER_PREFIX}最新真问题` }
  ]
  const reminderFlags = {
    repetitionRetried: false,
    reminderFailsafe: false,
    slimRetried: false,
    cutCallRetried: false,
    skipNudgeOnce: false
  }
  const reminderDecision = handleAgentFailure({
    round: {
      status: 'error',
      text: '模型服务返回错误(400):bad request',
      detail: 'bad request',
      httpStatus: 400
    },
    messages: reminderMessages,
    addendum: '',
    useTools: true,
    engineNoTools: false,
    flags: reminderFlags,
    doneCalls: new Set<string>(),
    callIdToKey: new Map<string, string>()
  })
  assert.equal(reminderDecision.kind, 'retry', '普通 4xx 也要重试')
  assert.ok(
    reminderDecision.kind === 'retry' && reminderDecision.step.includes('小注记'),
    '普通 4xx 走撤卡兜底'
  )
  assert.equal(reminderFlags.reminderFailsafe, true, '撤卡兜底只兜一次')

  console.log(
    '✅ agent 纯逻辑自测:路径安检 / 文件授权令牌(拖入即授权) / 额度 / 参数清洗 / 护栏 / 播报话术 / 流式碎片拼装 / 自动压缩 / 提醒卡垫撤 / 翻文件切片口径 / web_search 三道闸与上网守则 / 分流 / 紧急瘦身 / 黑名单兜底拼装 / 流式封板与正文不撤回 全部通过'
  )
}

await main()
