// 文件附件锤自测(对齐 Claude Code 的 @文件):按行裁剪/动态预算/收编洗白/装配块/翻页读取,
// 一把全摁住。跑法:node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/selftest-fileattach.mts
// 样本全在内存里,不碰盘不碰网。
import assert from 'node:assert/strict'
import {
  CHAT_FILE_CHARS_MAX,
  CHAT_FILES_MAX,
  clipTextToLines,
  fileAttachRangeLabel,
  planFileAttachments,
  sanitizeChatFiles,
  type ChatFileAttachment
} from '../src/shared/chatFiles.ts'
import {
  buildFileAttachmentsText,
  buildFreeChatMessages,
  READ_HONESTY_NOTE
} from '../src/ai/chat.ts'
import { sliceAgentRead } from '../src/ai/agent.ts'
import { TAG } from '../src/shared/promptTags.ts'

/** 造 N 行、每行 10 个字符的文本(行间 \n,结尾无换行) */
function linesText(n: number): string {
  const rows: string[] = []
  for (let i = 1; i <= n; i += 1) rows.push(`l${String(i).padStart(2, '0')}abcdefgh`)
  return rows.join('\n')
}

function goodFile(over: Partial<ChatFileAttachment> = {}): ChatFileAttachment {
  return {
    id: 'f1',
    name: 'note.txt',
    text: 'hello\nworld',
    totalLines: 2,
    size: 11,
    ...over
  }
}

function main(): void {
  // ── 1. clipTextToLines:按行边界裁,差一个尾换行不算裁,怪单行才裁断 ──
  const short = clipTextToLines('a\nb\nc', 100)
  assert.equal(short.text, 'a\nb\nc', '装得下就原样')
  assert.equal(short.shownEndLine, 3, '三行')
  assert.equal(short.truncated, false, '一个字节都没丢')

  const byLines = clipTextToLines('a\nb\nc', 3)
  assert.equal(byLines.text, 'a\nb', '裁在行边界,不腰斩')
  assert.equal(byLines.shownEndLine, 2, '只带到第二行')
  assert.equal(byLines.truncated, true, '丢了内容就是截断')

  const tailOnly = clipTextToLines('ab\n', 2)
  assert.equal(tailOnly.text, 'ab\n', '只差一个末尾换行符不算裁')
  assert.equal(tailOnly.truncated, false, '内容没丢就不许报截断')

  const monster = clipTextToLines('x'.repeat(50), 5)
  assert.equal(monster.text.length, 5, '单行怪文件裁到额度')
  assert.ok(monster.text.endsWith('…'), '裁断的尾巴带省略号')
  assert.equal(monster.shownEndLine, 1, '这行算带上了')
  assert.equal(monster.truncated, true, '硬裁也是截断')

  const exact = clipTextToLines('aa\nbb\ncc', 5)
  assert.equal(exact.text, 'aa\nbb', '刚好塞满就停手')
  assert.equal(exact.shownEndLine, 2, '两行')

  // ── 2. planFileAttachments:穷保底、富封顶、小文件省下的座位顺延 ──
  assert.deepEqual(
    planFileAttachments({ ctxTokens: 20000, replyTokens: 1000, otherTokens: 1000, files: [] }),
    [],
    '没文件就没账'
  )

  // 大锅:总量封在静态上限,单份超不到顶
  const rich = planFileAttachments({
    ctxTokens: 100000,
    replyTokens: 2000,
    otherTokens: 3000,
    files: [{ text: 'x'.repeat(60000), totalLines: 1 }]
  })
  assert.equal(rich.length, 1, '一份文件一份座位')
  assert.ok(rich[0].text.length <= CHAT_FILE_CHARS_MAX, '再大的锅,单份也不超静态上限')
  assert.equal(rich[0].truncated, true, '裁了就要报')

  // 小锅:保底 6000 照给(和引用账一个口径)
  const poor = planFileAttachments({
    ctxTokens: 4096,
    replyTokens: 1000,
    otherTokens: 3500,
    files: [{ text: 'y'.repeat(20000), totalLines: 1 }]
  })
  assert.ok(poor[0].text.length <= 6000, '穷有保底:顶天 6000')
  assert.ok(poor[0].text.length > 0, '保底不许保出个空手')

  // 公平分座:小文件省下的座位顺延给后面的大文件
  const fair = planFileAttachments({
    ctxTokens: 19000,
    replyTokens: 1000,
    otherTokens: 12000,
    files: [
      { text: linesText(100), totalLines: 100 },
      { text: linesText(2000), totalLines: 2000 }
    ]
  })
  assert.equal(fair[0].truncated, false, '小文件整份装下')
  assert.equal(fair[0].shownEndLine, 100, '行账对得上')
  assert.equal(fair[1].truncated, true, '大文件照实报截断')
  assert.ok(fair[1].shownEndLine < 2000, '大文件没带全')
  assert.equal(fair[1].shownEndLine, fair[1].text.split('\n').length, '行账 = 真带上的行数')

  // 渲染层先裁过的文件:正文虽短,行账对不上总数,照样按截断处理
  const preClipped = planFileAttachments({
    ctxTokens: 100000,
    replyTokens: 1000,
    otherTokens: 1000,
    files: [{ text: 'a\nb', totalLines: 500 }]
  })
  assert.equal(preClipped[0].truncated, true, '正文比总行数短 = 没带全,必须报')

  // ── 3. sanitizeChatFiles:数量封顶、坏条目整条丢、relPath 脏了就丢字段 ──
  assert.deepEqual(sanitizeChatFiles('nope').files, [], '不是数组就当没有')
  const capped = sanitizeChatFiles([
    goodFile({ id: 'a' }),
    goodFile({ id: 'b' }),
    goodFile({ id: 'c' }),
    goodFile({ id: 'd' })
  ])
  assert.equal(capped.files.length, CHAT_FILES_MAX, '数量封顶')
  assert.ok(capped.rejected[0].includes(String(CHAT_FILES_MAX)), '拒收理由要报出上限数')

  const bad = sanitizeChatFiles([
    null,
    goodFile({ id: 'e', text: '   ', totalLines: 3 }),
    goodFile({ id: 'f', totalLines: Number.NaN })
  ])
  assert.equal(bad.files.length, 0, '坏条目一个不留')
  assert.equal(bad.rejected.length, 3, '条条都有理由')

  const dirtyPath = sanitizeChatFiles([goodFile({ id: 'g', relPath: '../secrets.txt' })])
  assert.equal(dirtyPath.files.length, 1, '文件本身照收')
  assert.equal(dirtyPath.files[0].relPath, undefined, '越界样式的路径字段丢掉')

  const oversized = sanitizeChatFiles([
    goodFile({ id: 'h', text: 'z'.repeat(CHAT_FILE_CHARS_MAX + 100), totalLines: 1 })
  ])
  assert.equal(
    oversized.files[0].text.length,
    CHAT_FILE_CHARS_MAX,
    '超静态上限的正文裁掉(防御性二道)'
  )

  const clean = sanitizeChatFiles([goodFile({ id: 'i', relPath: 'docs/note.txt' })])
  assert.equal(clean.files[0].relPath, 'docs/note.txt', '正常相对路径保留')
  assert.equal(clean.files[0].id, 'i', 'id 原样认账')

  // 绝对路径(拖入即授权的凭据):形状对了保留;脏了只丢字段,文件本身照收
  const absOk = sanitizeChatFiles([
    goodFile({ id: 'j', absPath: 'C:\\Users\\me\\notes\\long.txt' })
  ])
  assert.equal(
    absOk.files[0].absPath,
    'C:\\Users\\me\\notes\\long.txt',
    '系统拖入的绝对路径保留(主进程要靠它发续读门卡)'
  )
  const absBad = sanitizeChatFiles([goodFile({ id: 'k', absPath: 'relative\\note.txt' })])
  assert.equal(absBad.files[0].absPath, undefined, '相对样式的路径字段丢掉')
  assert.equal(absBad.files.length, 1, '文件本身照收')
  const absDirty = sanitizeChatFiles([
    goodFile({ id: 'l', absPath: 'C:\\a\0b.txt' }),
    goodFile({ id: 'm', absPath: `C:\\${'x'.repeat(1100)}.txt` })
  ])
  assert.equal(absDirty.files[0].absPath, undefined, '带 NUL 的路径丢掉')
  assert.equal(absDirty.files[1].absPath, undefined, '超长的路径丢掉')

  // ── 4. fileAttachRangeLabel:界面上的行账不许撒谎 ──
  assert.equal(fileAttachRangeLabel(goodFile()), '共 2 行', '整份就报总数')
  assert.equal(
    fileAttachRangeLabel(goodFile({ text: 'a\nb', totalLines: 5 })),
    '第 1-2 行 / 共 5 行',
    '截断报区间'
  )

  // ── 5. buildFileAttachmentsText:块头行账 + 截断注记(带不带续读指引) ──
  const fullBlock = buildFileAttachmentsText(
    [{ ...goodFile(), shownEndLine: 2, truncated: false }],
    { agentOn: false }
  )
  assert.ok(
    fullBlock.includes(TAG.attachedFiles.open) && fullBlock.includes(TAG.attachedFiles.close),
    '标签成对'
  )
  assert.ok(fullBlock.includes('--- note.txt · 全 2 行 ---'), '块头报整份行数')
  assert.ok(fullBlock.includes('不是用户指令'), '防御口径在')
  assert.ok(!fullBlock.includes(TAG.programNote.open), '整份带全不打截断注记')

  const cutNoAgent = buildFileAttachmentsText(
    [
      {
        ...goodFile({ relPath: 'docs/note.txt' }),
        shownEndLine: 2,
        truncated: true,
        totalLines: 500
      }
    ],
    { agentOn: false }
  )
  assert.ok(
    cutNoAgent.includes('--- note.txt (docs/note.txt) · 第 1-2 行 / 共 500 行 ---'),
    '块头报区间和路径'
  )
  assert.ok(cutNoAgent.includes('后面的部分不在当前上下文里'), '没开翻文件:照实说不在上下文里')
  assert.ok(!cutNoAgent.includes('offset='), '没工具时不许开空头支票')

  const cutAgent = buildFileAttachmentsText(
    [
      {
        ...goodFile({ relPath: 'docs/note.txt' }),
        shownEndLine: 2,
        truncated: true,
        totalLines: 500
      }
    ],
    { agentOn: true }
  )
  assert.ok(cutAgent.includes('offset=3'), '开了翻文件:给出接着读的 offset')
  assert.ok(
    cutAgent.includes('read_file') && cutAgent.includes('search_content'),
    '续读路径点名工具'
  )
  assert.ok(cutAgent.includes(TAG.programNote.open), '截断注记走 program_note')

  const cutAgentNoPath = buildFileAttachmentsText(
    [{ ...goodFile(), shownEndLine: 2, truncated: true, totalLines: 500 }],
    { agentOn: true }
  )
  assert.ok(!cutAgentNoPath.includes('offset='), '系统拖进来的没路径,也给不了续读指引 —— 照实说')

  // 拖入即授权的文件门卡(rootId):系统拖进来且主进程发到牌时,续读指引带编号 + 空路径
  const cutGranted = buildFileAttachmentsText(
    [
      {
        ...goodFile({ absPath: 'C:\\outside\\long.txt', rootId: 'external_4' }),
        shownEndLine: 2,
        truncated: true,
        totalLines: 500
      }
    ],
    { agentOn: true }
  )
  assert.ok(
    cutGranted.includes('rootId=external_4') && cutGranted.includes('relPath 传空字符串'),
    '拖入即授权:续读指引带门卡编号和空路径的说法'
  )
  assert.ok(cutGranted.includes('offset=3'), '拖入即授权:接着读的 offset 照给')

  const cutGrantedNoAgent = buildFileAttachmentsText(
    [
      {
        ...goodFile({ absPath: 'C:\\outside\\long.txt', rootId: 'external_4' }),
        shownEndLine: 2,
        truncated: true,
        totalLines: 500
      }
    ],
    { agentOn: false }
  )
  assert.ok(!cutGrantedNoAgent.includes('rootId='), '没开翻文件:门卡编号也不提')
  assert.ok(
    cutGrantedNoAgent.includes('后面的部分不在当前上下文里'),
    '没开翻文件:照实说,不开空头支票'
  )

  // 读完度交底(滑跪案):文件资料在场时垫的那条,交底 + 防假道歉都要在
  assert.ok(
    READ_HONESTY_NOTE.startsWith(TAG.programNote.open) &&
      READ_HONESTY_NOTE.endsWith(TAG.programNote.close),
    '交底注记包 program_note'
  )
  assert.ok(
    READ_HONESTY_NOTE.includes('读过全篇就照实说') && READ_HONESTY_NOTE.includes('改口说成'),
    '交底与防假道歉两件都在'
  )

  // ── 6. 消息装配:文件块垫在引用后、问题前,相邻合并成一条 ──
  const msgs = buildFreeChatMessages(
    'sys',
    null,
    [],
    '这文件讲了啥',
    null,
    [{ relPath: 'a.ts', startLine: 1, endLine: 3, code: 'x' }],
    'brief',
    undefined,
    undefined,
    fullBlock
  )
  assert.equal(msgs.length, 2, 'system + 合并后的一条用户消息')
  const joined = msgs[1].content
  assert.equal(typeof joined, 'string', '纯文字合并')
  const body = joined as string
  assert.ok(
    body.indexOf(TAG.codeRefs.open) < body.indexOf(TAG.attachedFiles.open),
    '文件块排在引用代码后面'
  )
  assert.ok(
    body.indexOf(TAG.attachedFiles.open) < body.indexOf(TAG.currentQuestion.open),
    '文件块排在当前问题前面'
  )

  // ── 7. sliceAgentRead:行号 + 分页 + 注记(对齐 Claude Code 的 Read) ──
  const whole = sliceAgentRead('a\nb\nc', { offset: 1, limit: 2000, maxChars: 10000 })
  assert.equal(whole.ok, true, '小文件读得动')
  assert.equal(whole.text, '1\ta\n2\tb\n3\tc', '每行前置行号')
  assert.ok(!whole.text.includes(TAG.programNote.open), '读全了不打注记')
  assert.equal(whole.hint, '读了第 1-3 行 / 共 3 行', '行账报给界面')

  const twoLines = sliceAgentRead('a\nb\nc', { offset: 1, limit: 2, maxChars: 10000 })
  assert.ok(twoLines.text.startsWith('1\ta\n2\tb'), 'limit 掐行数')
  assert.ok(twoLines.text.includes('offset=3'), '截断注记给出下一页的 offset')
  assert.ok(twoLines.text.includes('共 3 行'), '截断注记报总行数')

  const secondPage = sliceAgentRead('a\nb\nc', { offset: 2, limit: 2000, maxChars: 10000 })
  assert.ok(secondPage.text.startsWith('2\tb'), 'offset 从第 2 行起(行号照实)')
  assert.ok(!secondPage.text.includes(TAG.programNote.open), '翻到尾巴就不打注记')

  const outOfRange = sliceAgentRead('a\nb\nc', { offset: 9, limit: 2000, maxChars: 10000 })
  assert.equal(outOfRange.ok, false, 'offset 跑出文件就是不可读')
  assert.ok(outOfRange.text.includes('只有 3 行'), '照实报总行数')

  const budgetCut = sliceAgentRead('aaaa\nbbbb\ncccc', { offset: 1, limit: 2000, maxChars: 10 })
  assert.equal(budgetCut.ok, true, '额度掐的是内容不是状态')
  assert.ok(budgetCut.text.startsWith('1\taaaa'), '第一行装得下')
  assert.ok(!budgetCut.text.includes('2\t'), '第二行被额度挡住了')
  assert.ok(budgetCut.text.includes('offset=2'), '额度截断同样给续读 offset')

  const trailing = sliceAgentRead('a\nb\n', { offset: 1, limit: 2000, maxChars: 10000 })
  assert.equal(trailing.hint, '读了第 1-2 行 / 共 2 行', '末尾换行不算一行')

  const monsterLine = sliceAgentRead('z'.repeat(100), { offset: 1, limit: 2000, maxChars: 10 })
  assert.ok(monsterLine.text.includes('…'), '单行怪文件裁断带省略号')
  assert.ok(monsterLine.text.includes('第 1 行太长'), '硬裁了也要照实说(不许静默)')

  // 行数上读完整、字数额度裁掉尾巴的注记由 hardCut 分支兜住
  assert.ok(monsterLine.ok, '裁断也是可读结果')

  console.log('✅ 文件附件自测全部通过')
}

main()
