// 文档族切块自测:只按空行切,不吞围栏、不把 --- 当 frontmatter,缩进保留。
import assert from 'node:assert/strict'
import { splitDocBlocks } from '../src/shared/plainBlocks.ts'
import { splitMdBlocks } from '../src/shared/mdBlocks.ts'
import { splitTranslateBlocks } from '../src/shared/translateBlocks.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('空行分段,块内换行留下', () => {
  const blocks = splitDocBlocks('第一段\n还在第一段\n\n第二段')
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].text, '第一段\n还在第一段')
  assert.equal(blocks[1].text, '第二段')
  assert.ok(blocks.every((b) => b.kind === 'prose'))
})

check('txt 里的围栏和 --- 不按 Markdown 吞后续段落', () => {
  const text = '开头\n\n```\ncode\n\nstill code\n```\n\n---\n\n结尾'
  const doc = splitDocBlocks(text)
  assert.ok(doc.length >= 4, `got ${doc.length}`)
  assert.equal(doc[0].text, '开头')
  const md = splitMdBlocks(text)
  assert.notEqual(doc.length, md.length)
})

check('rst 行首缩进原样保留,不 trim', () => {
  const blocks = splitDocBlocks('.. note::\n\n   这是注记\n   第二行')
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].text, '.. note::')
  assert.equal(blocks[1].text, '   这是注记\n   第二行')
})

check('空文档 / 全空行:没有块', () => {
  assert.deepEqual(splitDocBlocks(''), [])
  assert.deepEqual(splitDocBlocks('\n\n  \n'), [])
})

check('CRLF 与 Windows 路径:入口按族选切块', () => {
  const text = 'A\r\n\r\nB'
  assert.equal(splitTranslateBlocks(text, 'notes.txt').length, 2)
  const md = splitTranslateBlocks('```\nx\n\ny\n```\n\nz', 'a.md')
  assert.equal(md[0].kind, 'code')
  assert.equal(md.length, 2)
})

console.log('plainblocks: 全部通过')
