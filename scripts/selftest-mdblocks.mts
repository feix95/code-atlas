import assert from 'node:assert/strict'
import { joinMdBlocks, splitMdBlocks } from '../src/shared/mdBlocks.ts'
import { TRANSLATE_LANGS, translateLang } from '../src/shared/translateLangs.ts'

// 常规文档:frontmatter / 标题 / 段落 / 代码块 / 表格 / HTML 各归各位
{
  const md = [
    '---',
    'name: demo',
    '---',
    '',
    '# 标题',
    '',
    '一段 **正文**。',
    '',
    '```ts',
    'const a = 1',
    '',
    'const b = 2',
    '```',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '<div>x</div>',
    ''
  ].join('\n')
  const blocks = splitMdBlocks(md)
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['frontmatter', 'prose', 'prose', 'code', 'prose', 'meta']
  )
  assert.deepEqual(
    blocks.map((b) => b.index),
    [0, 1, 2, 3, 4, 5]
  )
  // 代码块里的空行不拆块
  assert.match(blocks[3].text, /const a = 1\n\nconst b = 2/)
  assert.equal(blocks[1].text, '# 标题')
  assert.match(blocks[2].text, /一段/)
}

// 波浪号围栏同样算代码块
{
  const blocks = splitMdBlocks('~~~\na\n\nb\n~~~\n\ntext')
  assert.equal(blocks[0].kind, 'code')
  assert.match(blocks[0].text, /a\n\nb/)
  assert.equal(blocks[1].kind, 'prose')
}

// 文中的 --- 不是 frontmatter(只有文首才算)
{
  const blocks = splitMdBlocks('开头\n\n---\n\n结尾')
  assert.equal(blocks.length, 3)
  assert.ok(blocks.every((b) => b.kind === 'prose'))
}

// 空文档 / 全空行:没有块,不炸
assert.deepEqual(splitMdBlocks(''), [])
assert.deepEqual(splitMdBlocks('\n\n  \n'), [])

// 列表与引用按空行分块,行内标记原样留着
{
  const blocks = splitMdBlocks('- 一\n- 二\n\n> 引用')
  assert.equal(blocks.length, 2)
  assert.match(blocks[0].text, /^- 一\n- 二$/)
  assert.equal(blocks[1].text, '> 引用')
}

// 拼回去:块间统一空一行,内容不丢
{
  const md = '# A\n\n正文\n\n```js\ncode\n```'
  const back = joinMdBlocks(splitMdBlocks(md))
  assert.equal(back, md)
}

// 语种表:八种、代号唯一、查得到
{
  assert.equal(TRANSLATE_LANGS.length, 8)
  assert.equal(new Set(TRANSLATE_LANGS.map((l) => l.code)).size, 8)
  assert.equal(translateLang('ja')?.label, '日本語')
  assert.equal(translateLang('nope'), null)
}

console.log('mdblocks: 全部通过')
