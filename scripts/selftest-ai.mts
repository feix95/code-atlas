import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  buildExplainPrompt,
  buildFolderPrompt,
  buildGuessPrompt,
  buildBinaryPrompt,
  buildLocatePrompt,
  buildTreeDigest,
  explainWithModel,
  explainWithMessages,
  buildFreeChatMessages,
  sanitizeHistory,
  sanitizeAttachment,
  buildAttachmentText,
  pickWebLookupQuery,
  resolveWebLookupMeta,
  buildRefineMessages,
  filterLocateHits,
  findTreeNode,
  hasWebLookupSignal,
  hasSearchIntent,
  parseLocateReply,
  LOCATE_NODE_BUDGET,
  WEB_SIGNAL_INSTRUCTION,
  sniffBinaryKind,
  FREE_CHAT_SYSTEM_PROMPT,
  FOLDER_SYSTEM_PROMPT,
  GUESS_SYSTEM_PROMPT,
  LOCATE_SYSTEM_PROMPT,
  isBinaryFile
} from '../src/ai/index.ts'
import { aiConfigPath, defaultAiConfig, loadAiConfig, resolveAiTarget, saveAiConfig } from '../src/ai/config.ts'
import { parseListenerPids, parseTasklistImage, resolveServerProgram } from '../src/ai/builtin.ts'
import { stripHtmlTags, webLookupDetailed } from '../src/ai/weblookup.ts'
import type { AiConfig, ChatContextAttachment, FileStructure, ScanDirNode } from '../src/shared/types.ts'

function sampleStructure(): FileStructure {
  return {
    languageId: 'typescript',
    imports: ['react'],
    exports: ['App'],
    functions: ['main'],
    classes: [],
    interfaces: [],
    reactComponents: []
  }
}

function cleanPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim()
}

function lmConfig(model: string, baseUrl = 'http://127.0.0.1:1234/v1'): AiConfig {
  return {
    provider: 'lmstudio',
    lmstudio: { baseUrl, model, apiKey: '' },
    builtin: { serverPath: '', modelPath: '' }
  }
}

async function main(): Promise<void> {
  // ── 1. 提示词构建:固定、把证据摆进去、绝不引入结构外的内容 ──
  const prompt = buildExplainPrompt({
    relPath: 'src/main.tsx',
    name: 'main.tsx',
    languageName: 'typescript-react',
    structure: sampleStructure(),
    graph: null
  })
  const p = cleanPrompt(prompt)
  assert.ok(p.includes('src/main.tsx'), '提示词应含文件路径')
  assert.ok(p.includes('main'), '提示词应含函数名')
  assert.ok(p.includes('App'), '提示词应含导出名')
  assert.ok(p.includes('react'), '提示词应含导入')
  assert.ok(!p.includes('不存在的函数'), '提示词不能夹带结构外的东西')

  // 空结构的边界:模型要被明确警告别编造
  const emptyPrompt = cleanPrompt(
    buildExplainPrompt({
      relPath: 'x.ts',
      name: 'x.ts',
      languageName: 'typescript',
      structure: { languageId: 'typescript', imports: [], exports: [], functions: [], classes: [], interfaces: [], reactComponents: [] },
      graph: null
    })
  )
  assert.ok(emptyPrompt.includes('不要编造'), '空结构要提醒模型别编造')

  // ── 2. 文件夹提示词:清单全进证据、完整路径认系统目录、根目录与截断都有人话 ──
  const fp = buildFolderPrompt({
    relPath: 'src/main',
    name: 'main',
    absPath: 'X:\\demo\\proj\\src\\main',
    subdirs: ['utils'],
    files: ['index.ts', 'server.ts', 'run.log'],
    languages: { TypeScript: 12, Python: 3 },
    extCounts: { '.ts': 12, '.py': 3, '.log': 1 }
  })
  assert.ok(fp.includes('src/main'), '文件夹提示词应含路径')
  assert.ok(fp.includes('X:\\demo\\proj\\src\\main'), '应含完整路径(模型靠它认系统目录)')
  assert.ok(fp.includes('utils'), '应含子文件夹名')
  assert.ok(fp.includes('index.ts'), '应含文件名')
  assert.ok(fp.includes('TypeScript×12'), '应含语言分布')
  assert.ok(fp.includes('.ts×12'), '应含通用后缀分布(编程语言)')
  assert.ok(fp.includes('.log×1'), '通用后缀分布要算上语言认不出的文件')
  assert.ok(fp.includes('文件类型分布'), '后缀分布要有标题行')
  assert.ok(fp.includes('系统目录'), '要有"认得系统目录就用常识"的引导')
  // 防摆烂条款:人设必须禁止"看不出来"一句甩烂,极端情况也要复述文件名(第三十七锤补丁)
  assert.ok(FOLDER_SYSTEM_PROMPT.includes('不许只回一句'), '文件夹人设要明确禁止一句摆烂')
  assert.ok(FOLDER_SYSTEM_PROMPT.includes('念出来'), '毫无辨识度时也要把观察到的文件名念出来')

  const fpRoot = buildFolderPrompt({
    relPath: '',
    name: 'code-atlas',
    absPath: 'X:\\demo\\code-atlas',
    subdirs: [],
    files: [],
    languages: {},
    extCounts: {}
  })
  assert.ok(fpRoot.includes('项目根目录'), '根目录要有说明')
  assert.ok(fpRoot.includes('没有可识别的代码文件'), '空清单要老实说')
  assert.ok(fpRoot.includes('(这个文件夹没有文件)'), '一个文件都没有时后缀分布要老实说')

  const manyFiles = Array.from({ length: 150 }, (_, i) => `f${i}.ts`)
  const fpBig = buildFolderPrompt({
    relPath: 'big',
    name: 'big',
    absPath: 'X:\\demo\\big',
    subdirs: [],
    files: manyFiles,
    languages: {},
    extCounts: { '.ts': 150, '.dll': 4, '.exe': 2 }
  })
  assert.ok(fpBig.includes('还有 50 个没列出'), '超量文件要注明截断')
  assert.ok(!fpBig.includes('f149.ts'), '没列出的文件不许混进提示词')
  assert.ok(fpBig.includes('.exe×2'), '后缀分布要带上系统文件夹的关键证据(exe/dll)')

  // 后缀种类超上限:只摆前 15 种,注明还剩多少种
  const manyExts = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`.x${i}`, 20 - i]))
  const fpExts = buildFolderPrompt({
    relPath: 'mixed',
    name: 'mixed',
    absPath: 'X:\\demo\\mixed',
    subdirs: [],
    files: [],
    languages: {},
    extCounts: manyExts
  })
  assert.ok(fpExts.includes('还有 5 种'), '超量后缀要注明截断')
  assert.ok(!fpExts.includes('.x15×'), '没列出的后缀不许混进提示词')

  // ── 3. 猜猜官提示词:完整路径 + 名字 + 片段进证据、读不了/空文件有人话 ──
  const gp = buildGuessPrompt({
    relPath: 'tools/deploy.sh',
    name: 'deploy.sh',
    absPath: 'X:\\demo\\proj\\tools\\deploy.sh',
    languageName: 'Shell',
    preview: 'echo start\ncp -r dist /var/www'
  })
  assert.ok(gp.includes('deploy.sh'), '应含文件名')
  assert.ok(gp.includes('X:\\demo\\proj\\tools\\deploy.sh'), '应含完整路径')
  assert.ok(gp.includes('cp -r dist'), '应含内容片段')
  assert.ok(gp.includes('Shell'), '应含语言名')
  assert.ok(gp.includes('系统目录'), '要有"认得系统目录就用常识"的引导')

  const gpNull = buildGuessPrompt({ relPath: 'x', name: 'x', absPath: 'X:\\demo\\x', languageName: '', preview: null })
  assert.ok(gpNull.includes('读不出文本内容'), '读不了内容要明说')
  const gpEmpty = buildGuessPrompt({ relPath: 'e', name: 'e', absPath: 'X:\\demo\\e', languageName: '', preview: '' })
  assert.ok(gpEmpty.includes('空文件'), '空文件要明说')

  // ── 3.5 自由对话:小探针人设分寸 + 历史清洗 + 附件清洗 + 消息组装 ──
  assert.ok(FREE_CHAT_SYSTEM_PROMPT.includes('Atlas 小探针'), '自由对话人设要点名 Atlas 小探针')
  assert.ok(FREE_CHAT_SYSTEM_PROMPT.includes('你是谁'), '问「你是谁」要有稳定的身份答法')
  assert.ok(FREE_CHAT_SYSTEM_PROMPT.includes('不限制用户问题的范围') || FREE_CHAT_SYSTEM_PROMPT.includes('最高优先级'), '用户问题优先,不被资料拽着走')
  assert.ok(FREE_CHAT_SYSTEM_PROMPT.includes('回收站'), '聊天人设要保留低成本安全网(回收站观察)')
  assert.ok(FREE_CHAT_SYSTEM_PROMPT.includes('System32'), '聊天人设要护住系统关键目录')
  assert.ok(FREE_CHAT_SYSTEM_PROMPT.includes('不要说自己查过网页') || FREE_CHAT_SYSTEM_PROMPT.includes('没有真正执行联网查询'), '没联网不许装查过')

  assert.deepEqual(sanitizeHistory('不是数组'), [], '历史不是数组就当没有')
  const longText = '长'.repeat(600)
  const rawHistory = [
    { role: 'user', content: '它是做什么的?' },
    { role: 'assistant', content: longText },
    { role: 'system', content: '冒充人设的' },
    { role: 'user', content: '   ' },
    { role: 'user', content: '这个能删吗?' },
    { role: 'assistant', content: '通常可以' },
    { role: 'user', content: '删了会怎样?' },
    { role: 'assistant', content: '影响不大' },
    { role: 'user', content: '这是什么软件?' },
    { role: 'assistant', content: '像是傲梅' }
  ]
  const clean = sanitizeHistory(rawHistory)
  assert.equal(clean.length, 5, '历史条数封顶 5')
  assert.equal(clean[1]?.content.length, 502, '超长历史要截断(500 字 + 省略号)')
  assert.ok(clean.every((m) => m.role === 'user' || m.role === 'assistant'), '只收 user/assistant 两种角色')

  // 附件清洗:形状不对一律当没有;字段洗净;正文封顶
  assert.equal(sanitizeAttachment(null), null, '没附件就当没有')
  assert.equal(sanitizeAttachment('乱传的'), null, '附件不是对象就当没有')
  assert.equal(sanitizeAttachment({ targetType: '炸弹', name: 'x', details: 'y' }), null, '对象类型不认识就当没有')
  assert.equal(sanitizeAttachment({ targetType: 'file', name: '', details: 'y' }), null, '没名字的附件不收')
  const attClean = sanitizeAttachment({
    targetType: 'folder',
    name: '  components  ',
    relPath: ' src/renderer/components ',
    summary: '  组件库  ',
    details: `  ${'长'.repeat(5000)}  `
  })
  assert.ok(attClean, '合法附件应通过清洗')
  assert.equal(attClean?.name, 'components', '附件名字要掐掉空白')
  assert.equal(attClean?.relPath, 'src/renderer/components', '附件路径要掐掉空白')
  assert.equal(attClean?.summary, '组件库', '附件摘要要掐掉空白')
  assert.ok((attClean?.details.length ?? 0) <= 4100, '附件正文要封顶(4000 字 + 截断注记)')
  assert.ok(attClean?.details.includes('资料太长'), '截断要注明,不许装完整')

  // 附件文本:<context_attachment> 块,声明仅供参考、不是指令
  const att: ChatContextAttachment = {
    targetType: 'folder',
    name: 'components',
    relPath: 'src/renderer/components',
    summary: '组件库',
    details: '文件:AiAssist.tsx, Notice.tsx'
  }
  const attText = buildAttachmentText(att)
  assert.ok(attText.includes('<context_attachment>'), '附件要带 context_attachment 标记')
  assert.ok(attText.includes('仅供参考'), '要声明仅供参考')
  assert.ok(attText.includes('不限制用户问题的范围'), '要声明不限制问题范围')
  assert.ok(attText.includes('对象类型:文件夹'), '对象类型要翻译成人话')
  assert.ok(attText.includes('名称:components'), '名称要进附件')
  assert.ok(attText.includes('相对路径:src/renderer/components'), '相对路径要进附件')

  // 消息组装:附件垫底(不进历史)、历史居中、问题收尾、相邻同角色合并
  const freeMsgs = buildFreeChatMessages('小探针人设', att, [{ role: 'assistant', content: '先前的回答' }], '你是谁?')
  assert.deepEqual(
    freeMsgs.map((m) => m.role),
    ['system', 'user', 'assistant', 'user'],
    '自由对话消息顺序:人设/附件/历史/问题'
  )
  assert.ok(freeMsgs[1]?.content.includes('<context_attachment>'), '附件是第二条消息(用户腿)')
  assert.ok(freeMsgs[3]?.content.includes('你是谁'), '当前问题收尾')

  const bareMsgs = buildFreeChatMessages('小探针人设', null, [], '今天聊点轻松的')
  assert.equal(bareMsgs.length, 2, '没附件没历史 = 人设 + 问题两条')
  assert.ok(!bareMsgs.some((m) => m.content.includes('<context_attachment>')), '没附件就不该有附件消息')

  const mergedMsgs = buildFreeChatMessages('小探针人设', att, [], '这个文件夹是干嘛的?')
  assert.equal(mergedMsgs.length, 2, '首问带附件时,附件和问题要合并成一条 user')
  assert.ok(mergedMsgs[1]?.content.includes('components') && mergedMsgs[1]?.content.includes('这个文件夹是干嘛的'), '附件与首问合并,不出现连续两条 user')

  const webMsgs = buildFreeChatMessages('小探针人设', att, [], '联网搜搜它', { query: 'Aomei', material: '维基:Aomei 是备份软件厂商' })
  assert.ok(webMsgs[webMsgs.length - 1]?.content.includes('Aomei 是备份软件厂商'), '联网资料要附在问题里')
  assert.ok(webMsgs[webMsgs.length - 1]?.content.includes('把资料里跟它对得上的信息讲出来'), '要要求模型讲出对得上的信息')

  // 联网查询词:优先选中对象的名字;没对象就剥掉意图词,封顶 60 字
  assert.equal(pickWebLookupQuery('联网搜搜它', att), 'components', '有选中对象就查名字')
  assert.equal(pickWebLookupQuery('联网搜一下这个软件', null), '这个软件', '没对象就剥掉意图词拿问题主体')
  assert.ok(pickWebLookupQuery('帮我查查', null).length <= 60, '查询词封顶 60 字')
  assert.equal(pickWebLookupQuery('帮我查查', null), '', '剥完啥都不剩就给空串,别拿垃圾去查')

  // 联网状态账本:程序做了什么就是什么,六种状态各有归属
  assert.equal(resolveWebLookupMeta(false, true, { kind: 'skipped' }).state, 'not_requested', '没点名 = not_requested')
  assert.equal(resolveWebLookupMeta(true, false, { kind: 'skipped' }).state, 'disabled', '点名但开关没开 = disabled')
  assert.equal(resolveWebLookupMeta(true, true, { kind: 'skipped' }).state, 'failed', '点名开着但没查成 = failed')
  assert.equal(resolveWebLookupMeta(true, true, { kind: 'error' }).state, 'failed', '查询抛错 = failed')
  assert.equal(resolveWebLookupMeta(true, true, { kind: 'attempted', material: '', sources: [] }).state, 'empty', '查完没料 = empty')
  const doneMeta = resolveWebLookupMeta(true, true, { kind: 'attempted', material: '资料', sources: ['维基百科(英文)'] })
  assert.equal(doneMeta.state, 'completed', '查到资料 = completed')
  assert.deepEqual(doneMeta.sources, ['维基百科(英文)'], '来源要记账')

  // ── 3.6 联网查证(默认关):信号词 + 修正消息 + 摘要洗白 ──
  assert.ok(WEB_SIGNAL_INSTRUCTION.includes('需要联网确认'), '信号词指令要包含标记原文')
  assert.ok(hasWebLookupSignal('回答正文。\n「需要联网确认」'), '带信号的回答要认出来')
  assert.ok(!hasWebLookupSignal('普通回答,没有信号'), '普通回答不误报')
  const refine = buildRefineMessages('导游人设', '证据清单', '首答:可能是某个软件。', '维基资料:傲梅是备份软件厂商')
  assert.deepEqual(
    refine.map((m) => m.role),
    ['system', 'user', 'assistant', 'user'],
    '修正消息顺序:人设/证据/首答/联网资料'
  )
  assert.ok(refine[3]?.content.includes('傲梅是备份软件厂商'), '联网资料要进修正消息')
  assert.ok(refine[3]?.content.includes('别硬编'), '资料对不上时要提醒维持原话')
  assert.equal(stripHtmlTags('<span class="x">傲梅</span> &amp; 备份  软件'), '傲梅 & 备份 软件', '维基摘要的 HTML 标记要剥干净')
  // 追问点名联网:意图词命中,开关关着/没命中就当普通问题
  assert.ok(hasSearchIntent('联网搜搜最新信息'), '「联网搜搜」要识别为搜索意图')
  assert.ok(hasSearchIntent('帮我查查这是什么软件'), '「查查」要识别为搜索意图')
  assert.ok(!hasSearchIntent('这个能删吗?'), '普通追问不该误触发联网')

  // ── 3.7 webLookupDetailed:来源记账 + 缓存 + 全灭认输 ──
  {
    let calls = 0
    const flakyFetch = async (url: string): Promise<string> => {
      calls++
      if (url.includes('zh.wikipedia')) throw new Error('被墙了') // 中文维基失败 → 换英文
      if (url.includes('en.wikipedia')) {
        return JSON.stringify({ query: { search: [{ title: 'AOMEI', snippet: 'backup <b>software</b> vendor' }] } })
      }
      return ''
    }
    const hit = await webLookupDetailed('Aomei 来源记账', flakyFetch)
    assert.equal(hit.sources[0], '维基百科(英文)', '命中的来源要记账')
    assert.ok(hit.material.includes('AOMEI'), '资料要带条目标题')
    assert.ok(hit.material.includes('backup software vendor'), '摘要的 HTML 要剥干净')
    const again = await webLookupDetailed('Aomei 来源记账', flakyFetch)
    assert.equal(again.material, hit.material, '同名第二次走缓存')
    assert.equal(calls, 2, '缓存生效:中文失败 1 次 + 英文成功 1 次,不再多发')
    const dead = await webLookupDetailed('查无此物xyz', async () => {
      throw new Error('全网断')
    })
    assert.equal(dead.material, '', '全部源失败 = 空资料')
    assert.deepEqual(dead.sources, [], '全部源失败 = 空来源')
    assert.equal((await webLookupDetailed('   ', flakyFetch)).material, '', '空查询不劳烦网络')
  }

  // ── 4. 二进制判断:媒体/二进制后缀表(svg 与无后缀不算) ──
  assert.ok(isBinaryFile('photo.PNG'), '大小写不敏感')
  assert.ok(isBinaryFile('app.exe'), '可执行文件是二进制')
  assert.ok(!isBinaryFile('logo.svg'), 'svg 是文本')
  assert.ok(!isBinaryFile('.gitignore'), '隐藏文件不算二进制')
  assert.ok(!isBinaryFile('Makefile'), '无后缀不算二进制')

  // ── 4.5 魔数识别:文件头认类型(真证据),认不出要老实说 ──
  const png = Buffer.alloc(24)
  png.set([0x89, 0x50, 0x4e, 0x47], 0)
  png.writeUInt32BE(1920, 16)
  png.writeUInt32BE(1080, 20)
  const pngKind = sniffBinaryKind(png, 'hero.png')
  assert.ok(pngKind, 'PNG 头应认出')
  assert.equal(pngKind?.type, 'PNG 图片', 'PNG 类型名')
  assert.equal(pngKind?.dims, '1920×1080', 'PNG 尺寸(宽×高)')

  const gif = Buffer.alloc(16)
  gif.write('GIF89a', 0, 'latin1')
  gif.writeUInt16LE(64, 6)
  gif.writeUInt16LE(64, 8)
  const gifKind = sniffBinaryKind(gif, 'logo.gif')
  assert.equal(gifKind?.type, 'GIF 图片', 'GIF 头应认出')
  assert.equal(gifKind?.dims, '64×64', 'GIF 尺寸(小端读宽高)')

  const zip = Buffer.alloc(4)
  zip.set([0x50, 0x4b, 0x03, 0x04], 0)
  assert.equal(sniffBinaryKind(zip, 'report.docx')?.type, 'Word 文档(Office 打包格式)', 'ZIP 容器按后缀细分出 docx')
  assert.equal(sniffBinaryKind(zip, 'bundle.jar')?.type, 'Java 归档包(JAR)', 'ZIP 容器按后缀细分出 jar')
  assert.equal(sniffBinaryKind(zip, 'pack.zip')?.type, 'ZIP 压缩包', '细分不出的就叫压缩包')

  const mp4 = Buffer.alloc(12)
  mp4.set([0x66, 0x74, 0x79, 0x70], 4)
  mp4.set(Buffer.from('isom', 'latin1'), 8)
  assert.ok(sniffBinaryKind(mp4, 'clip.mp4')?.type.includes('MP4'), 'ftyp 盒应认出 MP4')

  const sqlite = Buffer.from('SQLite format 3\0', 'latin1')
  assert.equal(sniffBinaryKind(sqlite, 'app.db')?.type, 'SQLite 数据库', 'SQLite 头应认出')

  const mz = Buffer.alloc(2)
  mz.set([0x4d, 0x5a], 0)
  assert.equal(sniffBinaryKind(mz, 'tool.exe')?.type, 'Windows 可执行文件或库(EXE/DLL)', 'MZ 头应认出')

  assert.equal(sniffBinaryKind(Buffer.from([1, 2, 3, 4]), 'x.dat'), null, '认不出就返回 null,不许瞎认')
  assert.equal(sniffBinaryKind(Buffer.alloc(2), 'short.bin'), null, '头太短认不了')

  // 二进制提示词:类型/尺寸/大小进证据,开头要声明"没看到内容"
  const bp = buildBinaryPrompt({ relPath: 'assets/hero.png', name: 'hero.png', typeInfo: 'PNG 图片,尺寸 1920×1080', sizeText: '2.3 MB' })
  assert.ok(bp.includes('PNG 图片,尺寸 1920×1080'), '类型和尺寸要进证据')
  assert.ok(bp.includes('2.3 MB'), '大小要进证据')
  assert.ok(bp.includes('assets/hero.png'), '路径要进证据')
  assert.ok(bp.includes('推测'), '要声明是推测')
  assert.ok(bp.includes('没有看到文件内容'), '要明说没看到内容')
  assert.ok(bp.includes('绝不许编造'), '要禁止编造')

  // JPEG 尺寸解析:SOF0 段之前垫一个带长度的 APP0(模拟 JFIF 头)
  const jpg = Buffer.alloc(64)
  jpg.set([0xff, 0xd8, 0xff], 0)
  jpg[3] = 0xe0 // APP0
  jpg.writeUInt16BE(16, 4) // 段长 16
  jpg[20] = 0xff
  jpg[21] = 0xc0 // SOF0
  jpg.writeUInt16BE(17, 22) // 段长
  jpg.writeUInt16BE(1080, 25) // 高(SOF0 段:FF C0 @20-21、段长 @22-23、精度 @24、高 @25-26、宽 @27-28)
  jpg.writeUInt16BE(1920, 27) // 宽
  assert.equal(sniffBinaryKind(jpg, 'photo.jpg')?.dims, '1920×1080', 'JPEG 顺着标记链走到 SOF0 读出尺寸(宽×高,与 PNG/GIF 同一约定)')

  // ── 5. 配置读写往返(新双 Provider 格式)+ 老格式自动搬家 ──
  const dir = await mkdtemp(join(tmpdir(), 'codeatlas-ai-'))
  try {
    const fallback = defaultAiConfig()
    assert.equal(fallback.provider, 'lmstudio', '默认 Provider 应为 LM Studio')
    assert.equal(fallback.lmstudio.baseUrl, 'http://127.0.0.1:1234/v1', '默认地址应为 LM Studio 本地服务')
    assert.equal(fallback.builtin.serverPath, '', '内置 Provider 默认未配置')

    const saved = await saveAiConfig(dir, {
      provider: 'builtin',
      lmstudio: { baseUrl: '  http://127.0.0.1:1234/v1  ', model: 'Qwen3.8-27B', apiKey: '' },
      builtin: { serverPath: ' D:\\tools\\llama-server.exe ', modelPath: 'F:\\models\\qwen.gguf' },
      webLookup: true
    })
    assert.equal(saved.provider, 'builtin', 'Provider 应保存')
    assert.equal(saved.lmstudio.baseUrl, 'http://127.0.0.1:1234/v1', 'baseUrl 应去掉首尾空格')
    assert.equal(saved.builtin.serverPath, 'D:\\tools\\llama-server.exe', 'serverPath 应去掉首尾空格')
    assert.equal(saved.webLookup, true, '联网查证开关应保存')
    const loaded = await loadAiConfig(dir)
    assert.equal(loaded.provider, 'builtin', '重新读回 Provider')
    assert.equal(loaded.lmstudio.model, 'Qwen3.8-27B', '重新读回模型名')
    assert.equal(loaded.builtin.modelPath, 'F:\\models\\qwen.gguf', '重新读回模型文件路径')
    assert.equal(loaded.webLookup, true, '重新读回联网查证开关')
    assert.equal(defaultAiConfig().webLookup, false, '联网查证默认必须是关')

    // 老版本配置是扁平的 {baseUrl, model, apiKey}:load 时要自动搬进 lmstudio 分支
    await writeFile(
      aiConfigPath(dir),
      JSON.stringify({ baseUrl: 'http://127.0.0.1:1234/v1', model: '老配置模型', apiKey: 'sk-old' }),
      'utf8'
    )
    const migrated = await loadAiConfig(dir)
    assert.equal(migrated.provider, 'lmstudio', '老配置迁移后 Provider 应为 lmstudio')
    assert.equal(migrated.lmstudio.model, '老配置模型', '老配置的模型名应搬进 lmstudio 分支')
    assert.equal(migrated.lmstudio.apiKey, 'sk-old', '老配置的 apiKey 应保留')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  // ── 6. resolveAiTarget:两个 Provider 收敛成同一个 ChatTarget ──
  const lmOk = resolveAiTarget(lmConfig('gpt-本地'))
  assert.ok(lmOk.ok, 'LM Studio 配好模型应解析成功')
  assert.equal(lmOk.ok && lmOk.target.baseUrl, 'http://127.0.0.1:1234/v1', '目标地址来自 lmstudio 设置')
  assert.equal(lmOk.ok && lmOk.target.model, 'gpt-本地', '目标模型名来自 lmstudio 设置')

  const lmNoModel = resolveAiTarget(lmConfig(''))
  assert.ok(!lmNoModel.ok, 'LM Studio 没选模型应解析失败')
  assert.ok(!lmNoModel.ok && lmNoModel.message.includes('AI 设置'), '失败要给人话指引')

  const biMissing = resolveAiTarget({ ...lmConfig(''), provider: 'builtin' })
  assert.ok(!biMissing.ok, '内置 Provider 没选模型应解析失败')
  assert.ok(!biMissing.ok && biMissing.message.includes('还没选模型'), '失败要指向选模型这个动作')

  const biOk = resolveAiTarget({ ...lmConfig(''), provider: 'builtin' }, { baseUrl: 'http://127.0.0.1:8766/v1', model: 'qwen-7b' })
  assert.ok(biOk.ok, '内置 Provider 有运行时应解析成功')
  assert.equal(biOk.ok && biOk.target.baseUrl, 'http://127.0.0.1:8766/v1', '目标地址来自子进程运行时')
  assert.equal(biOk.ok && biOk.target.model, 'qwen-7b', '目标模型名来自子进程报告')

  // ── 6.5 引擎自动定位:填了就用填的;没填找 app 自带的;都没有给人话错误 ──
  const exeDir = await mkdtemp(join(tmpdir(), 'codeatlas-builtin-'))
  try {
    const exePath = join(exeDir, 'llama-server.exe')
    await writeFile(exePath, 'fake engine')
    assert.equal(resolveServerProgram(`  ${exePath}  `), exePath.trim(), '手动填的路径应去掉空格原样使用')

    let threw = ''
    try {
      resolveServerProgram('D:\\不存在\\llama-server.exe')
    } catch (err) {
      threw = err instanceof Error ? err.message : String(err)
    }
    assert.ok(threw.includes('找不到'), '不存在的程序路径要给人话错误')

    // 没填路径时回退到 app 自带引擎;引擎没下载就跳过这条(dev 机器上通常已就位)
    const bundled = join(process.cwd(), 'vendor', 'llama-cpp', 'llama-server.exe')
    if (existsSync(bundled)) {
      assert.equal(resolveServerProgram(''), bundled, '没填路径应自动用内置引擎')
    }
  } finally {
    await rm(exeDir, { recursive: true, force: true })
  }

  // ── 6.6 孤儿收尸的纯函数:netstat / tasklist 输出解析(端口认领要精确,击杀要验明正身) ──
  const netstatSample = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    127.0.0.1:8766         0.0.0.0:0              LISTENING       1234',
    '  TCP    [::]:8766              [::]:0                 LISTENING       5678',
    '  TCP    127.0.0.1:18766        0.0.0.0:0              LISTENING       99',
    '  TCP    127.0.0.1:8765         1.2.3.4:5555           ESTABLISHED     42'
  ].join('\n')
  assert.deepEqual(parseListenerPids(netstatSample, 8766), [1234, 5678], '应找出监听 8766 的 PID(18766/8765/非监听都不算)')
  assert.deepEqual(parseListenerPids('  TCP    0.0.0.0:8766    0.0.0.0:0    LISTENING    not-a-pid', 8766), [], 'PID 不是数字就不收')
  assert.deepEqual(parseListenerPids('', 8766), [], '空输出给空清单')
  assert.equal(
    parseTasklistImage('"llama-server.exe","1234","Console","1","123,456 K"'),
    'llama-server.exe',
    'tasklist CSV 应抠出映像名'
  )
  assert.equal(parseTasklistImage('INFO: 没有运行的任务匹配指定的标准。'), '', '查无此进程应得空串,绝不凭空杀人')

  // ── 7. 用本地假模型服务验证整条 fetch → 解析链路(非流式 + SSE 流式) ──
  const receivedBodies: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      receivedBodies.push(body)
      const wantsStream = body.includes('"stream":true')
      if (wantsStream) {
        // SSE 流式:分三帧发,中间夹一个心跳注释,最后一帧 [DONE]
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: {"choices":[{"delta":{"content":"这个文件是应用的"}}]}\n\n')
        res.write(': keep-alive 心跳,不是数据帧\n\n')
        res.write('data: {"choices":[{"delta":{"content":"入口,负责启动主界面。"}}]}\n\n')
        res.end('data: [DONE]\n\n')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '这个文件是应用的入口,负责启动主界面。' } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object', '假服务应监听在端口上')
  const port = address.port
  const target = { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'fake-model' }

  try {
    // 非流式:老行为不变
    const result = await explainWithModel(target, prompt)
    assert.equal(result.status, 'supported', '应成功拿到解释')
    assert.ok(result.text.includes('入口'), '解析出的内容应是模型回复')
    assert.equal(result.model, 'fake-model', '回显所用模型')

    // 请求体断言:模型名与消息结构要对,且非流式请求不带 stream:true
    const sent = JSON.parse(receivedBodies[0] ?? '') as { model: string; messages: Array<{ role: string; content: string }>; stream?: boolean }
    assert.equal(sent.model, 'fake-model', '发出去的模型名应是配置里的')
    assert.equal(sent.messages.length, 2, '应有两段消息(system + user)')
    assert.equal(sent.messages[0]?.role, 'system', '第一段是系统人设')
    assert.equal(sent.messages[1]?.role, 'user', '第二段是用户提示词')
    assert.notEqual(sent.stream, true, '没传 onDelta 就不该请求流式')

    // 流式:onDelta 逐段推送,拼起来 = 最终全文
    const pieces: string[] = []
    const streamRes = await explainWithModel(target, prompt, undefined, (t) => pieces.push(t))
    assert.equal(streamRes.status, 'supported', '流式请求应成功')
    assert.equal(streamRes.text, pieces.join(''), '流式增量拼起来应等于最终全文')
    assert.ok(streamRes.text.includes('入口'), '流式内容应是模型回复')
    assert.ok(pieces.length >= 2, '增量应分多段到达(边生成边显示)')
    assert.ok(receivedBodies[receivedBodies.length - 1]?.includes('"stream":true'), '传了 onDelta 就应请求流式')

    // 猜猜官人设:同一管道,换系统提示词后发出去的人设要跟着换
    const guessRes = await explainWithModel(target, gp, GUESS_SYSTEM_PROMPT)
    assert.equal(guessRes.status, 'supported', '猜猜官链路应通')
    const allBodies = receivedBodies.join('\n')
    assert.ok(allBodies.includes('猜猜官'), '猜猜官人设应发到服务')
    assert.ok(allBodies.includes('tools/deploy.sh'), '猜猜官提示词应带上文件证据')

    // 自由对话流:附件垫底(不进历史)、人设和资料原样发出去,角色和顺序不变形
    const freeMessages = buildFreeChatMessages(
      FREE_CHAT_SYSTEM_PROMPT,
      { targetType: 'folder', name: 'Aomei', relPath: 'D:/Aomei', summary: '软件残留', details: '文件:卸载说明.txt' },
      [{ role: 'assistant', content: '这是备份软件的残留' }],
      '你是谁？'
    )
    const freeRes = await explainWithMessages(target, freeMessages)
    assert.equal(freeRes.status, 'supported', '自由对话链路应通')
    const freeBody = JSON.parse(receivedBodies[receivedBodies.length - 1] ?? '') as {
      messages: Array<{ role: string; content: string }>
    }
    assert.equal(freeBody.messages.length, 4, '自由对话消息 = 人设 + 附件 + 历史 + 当前问题')
    assert.ok(freeBody.messages[0]?.content.includes('Atlas 小探针'), '小探针人设要发到服务')
    assert.ok(freeBody.messages[1]?.content.includes('<context_attachment>'), '资料附件按用户消息垫底')
    assert.ok(freeBody.messages[1]?.content.includes('仅供参考'), '附件要声明仅供参考')
    assert.equal(freeBody.messages[2]?.role, 'assistant', '历史里的回答要按 assistant 摆')
    assert.ok(freeBody.messages[3]?.content.includes('你是谁'), '当前问题收尾')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  // ── 8. 服务连不上:应返回 error 状态而不是抛异常 ──
  const down = await explainWithModel({ baseUrl: 'http://127.0.0.1:1/v1', model: 'x' }, prompt)
  assert.equal(down.status, 'error', '连不上服务时状态应为 error')
  assert.ok(down.text.includes('连不上'), '错误信息要提示检查模型服务')

  // ── 9. 功能定位(第六十七锤):地图摊开 / 回复解析 / 防编造过滤 ──
  assert.ok(LOCATE_SYSTEM_PROMPT.includes('不许编造'), '带路人人设要有防编造铁律')
  assert.ok(LOCATE_SYSTEM_PROMPT.includes('{"hits":'), '带路人人设要带 JSON 格式样例')
  const locateTree: ScanDirNode = {
    type: 'directory',
    name: 'demo',
    relPath: '',
    summary: { emoji: '🏠', text: 'demo 项目' },
    children: [
      {
        type: 'directory',
        name: 'src',
        relPath: 'src',
        summary: { emoji: '📦', text: '源代码都在这' },
        children: [
          {
            type: 'file',
            name: 'main.tsx',
            relPath: 'src/main.tsx',
            ext: '.tsx',
            language: { id: 'typescript-react', name: 'TypeScript React', source: 'extension' },
            summary: { emoji: '🚪', text: '程序的大门' }
          },
          {
            type: 'file',
            name: 'config.ts',
            relPath: 'src/config.ts',
            ext: '.ts',
            language: { id: 'typescript', name: 'TypeScript', source: 'extension' },
            summary: { emoji: '⚙️', text: '配置都在这' }
          }
        ]
      },
      { type: 'file', name: 'README.md', relPath: 'README.md', ext: '.md', summary: { emoji: '📖', text: '说明书' } }
    ]
  }

  // 地图摊开:每行带完整 relPath + 类型标注 + 一句话;广度优先(浅层先画)
  const digest = buildTreeDigest(locateTree)
  assert.ok(digest.includes('(项目根) [目录]'), '根节点要标成项目根')
  assert.ok(digest.includes('src/main.tsx [文件·TypeScript React] —— 程序的大门'), '文件行要带路径/语言/一句话')
  assert.ok(digest.indexOf('README.md') < digest.indexOf('src/main.tsx'), '广度优先:浅层要排在深层前面')
  // 预算截断:预算用尽要如实注明地图不全,不许装作画全了
  const capped = buildTreeDigest(locateTree, 3)
  assert.equal(capped.split('\n').filter((l) => !l.startsWith('(地图没画全')).length, 3, '超预算要截断到预算行数')
  assert.ok(capped.includes('地图没画全'), '截断要注明')
  assert.ok(LOCATE_NODE_BUDGET >= 100, '预算要有基本容量,别小气到地图没法用')

  // 提示词拼装:地图 + 问题 + 「逐字照抄路径」的硬要求
  const locatePrompt = buildLocatePrompt({ digest, question: '程序从哪启动' })
  assert.ok(locatePrompt.includes('用户想知道:程序从哪启动'), '问题要进提示词')
  assert.ok(locatePrompt.includes('逐字照抄'), '要硬要求模型照抄路径')

  // 回复解析:裸 JSON / 围栏包裹 / 前后夹话都能读;反斜杠统一成正斜杠;垃圾回空
  const parsed = parseLocateReply('{"hits":[{"relPath":"src\\\\main.tsx","reason":"大门在这","confidence":88}]}')
  assert.equal(parsed.length, 1, '裸 JSON 要能解析')
  assert.equal(parsed[0]?.relPath, 'src/main.tsx', '反斜杠要统一成正斜杠')
  assert.equal(parsed[0]?.reason, '大门在这')
  assert.equal(parsed[0]?.confidence, 88)
  const fenced = parseLocateReply('好的,指路如下:\n```json\n{"hits":[{"relPath":"src/config.ts","reason":"配置","confidence":150}]}\n```\n请查收')
  assert.equal(fenced[0]?.relPath, 'src/config.ts', '围栏包裹要能剥掉')
  assert.equal(fenced[0]?.confidence, 100, 'confidence 要夹在 0~100')
  const noReason = parseLocateReply('{"hits":[{"relPath":"README.md"}]}')
  assert.ok(noReason[0]?.reason.length, '没给理由要兜底一句,不许空着')
  assert.equal(parseLocateReply('我觉得是 main.tsx,不解释').length, 0, '没 JSON 要回空')
  assert.equal(parseLocateReply('{"hits":"不是数组"}').length, 0, 'hits 不是数组要回空')
  assert.equal(parseLocateReply('{"hits":[{"reason":"没路径"}]}').length, 0, '没 relPath 的命中要扔')
  const seven = parseLocateReply(
    JSON.stringify({ hits: Array.from({ length: 7 }, (_, i) => ({ relPath: `f${i}.ts`, reason: 'x' })) })
  )
  assert.equal(seven.length, 5, '命中最多 5 个,防话痨')

  // 防编造:指的每个地址对照真树点名,编造的当场扔;目录也是合法命中;按把握排序
  assert.equal(findTreeNode(locateTree, 'src')?.type, 'directory', '目录命中要认得出')
  assert.equal(findTreeNode(locateTree, 'src/main.tsx')?.type, 'file', '文件命中要认得出')
  assert.equal(findTreeNode(locateTree, 'src/ghost.ts'), null, '编造的路径要点名点不出来')
  const filtered = filterLocateHits(locateTree, [
    { relPath: 'src/ghost.ts', reason: '编的', confidence: 99 },
    { relPath: 'README.md', reason: '说明书', confidence: 30 },
    { relPath: 'src/config.ts', reason: '配置', confidence: 70 }
  ])
  assert.deepEqual(
    filtered.map((h) => h.relPath),
    ['src/config.ts', 'README.md'],
    '编造的要扔掉,剩下的按把握从大到小排'
  )

  console.log('✅ AI 人话解释自测全部通过')
  console.log('   提示词固定不编造 · 完整路径与通用后缀分布 · 自由对话(小探针人设/附件清洗/消息组装/联网账本) · 二进制照样讲 · 双 Provider 配置与老格式迁移 · resolveAiTarget 收敛 · 非流式与 SSE 流式链路通 · 人设随场景切换 · 功能定位(带路人/地图摊开/回复解析/防编造)')
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
