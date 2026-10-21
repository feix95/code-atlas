/** 文档族切块(纯函数):只按空行分段,每一段都当散文。
 *
 * 与 splitMdBlocks 的差别:不吞围栏、不把文首 --- 当 frontmatter、不把 HTML 标成不翻。
 * 块内换行与行首缩进原样保留(.rst / .adoc 的缩进是语法)。分块只由原文决定。
 */
import type { MdBlockSlice } from './mdBlocks.ts'

function isBlank(line: string): boolean {
  return line.trim() === ''
}

export function splitDocBlocks(text: string): MdBlockSlice[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlockSlice[] = []
  let i = 0
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i++
      continue
    }
    const start = i
    while (i < lines.length && !isBlank(lines[i])) i++
    const chunk = lines.slice(start, i).join('\n')
    if (chunk === '') continue
    blocks.push({ index: blocks.length, text: chunk, kind: 'prose' })
  }
  return blocks
}
