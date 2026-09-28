// 迷你 Markdown 解析器的自测(阅读模式锤):解析层是纯数据 AST(src/shared/markdown.ts),
// 直接把块树对账本 —— 表格/嵌套列表/待办/callout/段落合并这些新来的语法,
// 拆错一格树账就当场对不上。纯函数,不碰系统。
import assert from 'node:assert/strict'
import { parseInline, parseMarkdown, type MdBlock, type MdList } from '../src/shared/markdown.ts'

/** 从块树里按类型领证 */
function blocksOf(text: string): MdBlock[] {
  return parseMarkdown(text)
}

function types(blocks: MdBlock[]): string[] {
  return blocks.map((b) => b.t)
}

function main(): void {
  // ── 1. 表格:头 + 分隔 + 数据行,对齐户口照分隔行 ──
  const tbl = blocksOf('| 项 | 说 | 数 |\n|----|:--:|---:|\n| a | **粗** | 1 |\n| b | c | 2 |')
  assert.deepEqual(types(tbl), ['table'], '一张表占一个块')
  const t0 = tbl[0]
  assert.equal(t0.t, 'table')
  if (t0.t !== 'table') return
  assert.deepEqual(t0.aligns, ['left', 'center', 'right'], ':--: 居中、--: 右、默认左')
  assert.equal(t0.head.length, 3, '表头三格')
  assert.equal(t0.body.length, 2, '两行数据')
  assert.equal(t0.body[0][1][0]?.t, 'bold', '单元格里 **粗** 仍是粗体,不是死字')

  // 没有分隔行的 | 行是段落,不许硬凑表
  const notTable = blocksOf('a | b\nc | d')
  assert.deepEqual(types(notTable), ['para'], '缺分隔行:普通段落,不装表格')

  // 分隔行自己不许被当 hr 吃掉(先于表格判定独立成立)
  const onlySep = blocksOf('|----|----|')
  assert.deepEqual(types(onlySep), ['para'], '裸分隔行只是一行文字')

  // ── 2. 标题四级 ──
  const heads = blocksOf('# 一\n## 二\n### 三\n#### 四')
  assert.deepEqual(
    heads.map((b) => (b.t === 'heading' ? b.level : 0)),
    [1, 2, 3, 4],
    'h1–h4 各级都认'
  )

  // ── 3. 列表:嵌套折树、有序无序、待办 ──
  const list = blocksOf('- 甲\n  - 子一\n  - 子二\n- 乙')
  assert.equal(list.length, 1, '一张列表块')
  const l0 = list[0] as MdList
  assert.equal(l0.t, 'list')
  assert.equal(l0.ordered, false, '无序')
  assert.equal(l0.items.length, 2, '顶格两项')
  const sub = l0.items[0].sub
  assert.ok(sub && sub.t === 'list', '缩进项挂成子列表,不是摊平')
  assert.equal(sub.items.length, 2, '子列表两项')
  assert.equal(l0.items[1].sub, undefined, '乙没儿子')

  const ordered = blocksOf('1. 第一\n2. 第二')
  assert.equal((ordered[0] as MdList).ordered, true, '数字头是 ol')

  const tasks = blocksOf('- [ ] 没干\n- [x] 干了\n- [X] 大写也算')
  const tl = tasks[0] as MdList
  assert.deepEqual(
    tl.items.map((it) => it.done),
    [false, true, true],
    '待办勾选态:空格=x都认'
  )
  assert.equal(
    tl.items[0].content.map((n) => ('text' in n ? n.text : '')).join(''),
    '没干',
    '待办标记 [ ] 不进正文'
  )

  // ── 4. 段落合并:相邻行是一段,空行才分家 ──
  const paras = blocksOf('第一行\n第二行\n\n第三行')
  assert.deepEqual(types(paras), ['para', 'para'], '空行分两段,中间那行是合并的')
  const joined = paras[0]
  if (joined.t === 'para') {
    assert.equal(
      joined.content.map((n) => ('text' in n ? n.text : '')).join(''),
      '第一行\n第二行',
      '软换行保留为 \\n(渲染时白空格即空格)'
    )
  }

  // 列表紧跟段落不许被段落吞掉
  const mixed = blocksOf('前话\n- 项一\n- 项二')
  assert.deepEqual(types(mixed), ['para', 'list'], '列表把段落截断')

  // ── 5. 引用:多行合并成一块,里面还能有列表 ──
  const quote = blocksOf('> 第一行\n> 第二行\n\n外话')
  assert.deepEqual(types(quote), ['quote', 'para'], '两行 > 是一块引用')
  const q = quote[0]
  if (q.t === 'quote') {
    assert.equal(q.children.length, 1, '引用内文合成一段')
    assert.equal(
      q.children[0].t === 'para'
        ? q.children[0].content.map((n) => ('text' in n ? n.text : '')).join('')
        : '',
      '第一行\n第二行',
      '引用内的行也按段落合并'
    )
  }

  // callout:> [!warning] 升级成带色板的提示块
  const call = blocksOf('> [!warning] 当心\n> 里面的话')
  const c0 = call[0]
  assert.equal(c0.t, 'callout')
  if (c0.t === 'callout') {
    assert.equal(c0.kind, 'warn', 'warning 落 warn 档')
    assert.equal(c0.title, '当心', '自定义标题照字走')
    assert.equal(c0.children.length, 1, '标题行不吃进正文')
  }
  const callDefault = blocksOf('> [!tip]\n> 身子')
  if (callDefault[0].t === 'callout') {
    assert.equal(callDefault[0].kind, 'tip', 'tip 落 tip 档')
    assert.equal(callDefault[0].title, 'tip', '没写标题就用类型名')
  }

  // ── 6. 围栏代码:里面一个字不动 ──
  const fenced = blocksOf('```\n**不是粗体** | a | b\n```\n\n- 外头')
  assert.deepEqual(types(fenced), ['code', 'list'], '围栏是一块代码,后面列表照常')
  const f0 = fenced[0]
  if (f0.t === 'code') {
    assert.equal(f0.text, '**不是粗体** | a | b', '围栏内原样保留')
  }

  // ── 7. 行内语法全家 ──
  const inl = parseInline('粗**b** 斜*i* 下_u_ 删~~d~~ 亮==m== 链[L](u) 码`c`')
  assert.deepEqual(
    inl.map((n) => n.t),
    [
      'text',
      'bold',
      'text',
      'em',
      'text',
      'em',
      'text',
      'del',
      'text',
      'mark',
      'text',
      'link',
      'text',
      'code'
    ],
    '粗/斜/删/亮/链/码全认得出'
  )
  const link = inl.find((n) => n.t === 'link')
  assert.equal(link && link.t === 'link' ? link.href : '', 'u', '链接的 href 单独收')

  // _ 不许词内斜(CommonMark):a_b_c 全字留
  const wordUnder = parseInline('a_b_c')
  assert.deepEqual(wordUnder, [{ t: 'text', text: 'a_b_c' }], '词内 _ 不是斜体')

  // 行内代码护体:`**b**` 是码不是粗
  const codeShield = parseInline('看 `**b**` 它')
  assert.deepEqual(
    codeShield.map((n) => n.t),
    ['text', 'code', 'text'],
    '行内代码里的 ** 不当粗体'
  )

  // ── 8. hr 与边界 ──
  assert.deepEqual(types(blocksOf('上\n\n---\n\n下')), ['para', 'hr', 'para'], '--- 是分割线')
  assert.deepEqual(types(blocksOf('上\n\n___\n\n下')), ['para', 'hr', 'para'], '___ 也算')

  console.log('✅ 迷你 Markdown 解析自测全部通过')
  console.log(
    '   表格(对齐/行内语法) · 标题四级 · 嵌套/有序/待办列表 · 段落合并 · 引用与 callout · 围栏护体 · 行内全家 · hr'
  )
}

main()
