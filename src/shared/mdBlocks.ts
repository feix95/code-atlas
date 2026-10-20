/** Markdown 顶层分块(纯函数,自测见 scripts/selftest-mdblocks.mts)。
 *
 * 原文与译文共用同一份块序号:悬停对照靠它对号,所以切法必须只由原文决定,
 * 翻译结果回来多少块都改不了这个账。
 *
 * 切法:空行分段;围栏代码块整块吞(块里夹空行也不拆);文首 frontmatter 单独成块(只翻值);
 * 以标签开头的 HTML 块不送模型。文字块送模型翻。
 */

export type MdBlockKind = 'prose' | 'code' | 'meta' | 'frontmatter'

export interface MdBlockSlice {
  /** 块序号(从 0 起,原文译文共用) */
  index: number
  /** 块原文(去首尾空白,内部原样) */
  text: string
  kind: MdBlockKind
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

/** 围栏开标记:``` 或 ~~~ 三个以上,允许缩进 */
function fenceOf(line: string): { char: string; length: number } | null {
  const m = /^\s*(`{3,}|~{3,})/.exec(line)
  if (!m) return null
  return { char: m[1][0], length: m[1].length }
}

/** 与开标记同字符、长度不短于它的闭标记 */
function closesFence(line: string, fence: { char: string; length: number }): boolean {
  const m = /^\s*(`{3,}|~{3,})\s*$/.exec(line)
  return m !== null && m[1][0] === fence.char && m[1].length >= fence.length
}

/** 看块的样子定去处:代码块与 HTML 块不翻,其余按散文处理 */
function kindOf(text: string, forced?: MdBlockKind): MdBlockKind {
  if (forced) return forced
  if (/^\s*</.test(text)) return 'meta'
  return 'prose'
}

export function splitMdBlocks(md: string): MdBlockSlice[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlockSlice[] = []
  let i = 0

  function push(text: string, forced?: MdBlockKind): void {
    const trimmed = text.trim()
    if (trimmed === '') return
    blocks.push({ index: blocks.length, text: trimmed, kind: kindOf(trimmed, forced) })
  }

  // 文首 frontmatter:--- 开头、--- 收尾,整块原样
  if (lines.length > 0 && lines[0].trim() === '---') {
    let end = -1
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].trim() === '---') {
        end = j
        break
      }
    }
    if (end > 0) {
      push(lines.slice(0, end + 1).join('\n'), 'frontmatter')
      i = end + 1
    }
  }

  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i++
      continue
    }

    const fence = fenceOf(lines[i])
    if (fence) {
      const start = i
      i++
      while (i < lines.length && !closesFence(lines[i], fence)) i++
      if (i < lines.length) i++ // 吃掉闭标记
      push(lines.slice(start, i).join('\n'), 'code')
      continue
    }

    const start = i
    while (i < lines.length && !isBlank(lines[i])) i++
    push(lines.slice(start, i).join('\n'))
  }

  return blocks
}

/** 把块重新拼回文档(译文页按块渲染,这个只给自测和导出用) */
export function joinMdBlocks(blocks: Array<{ text: string }>): string {
  return blocks.map((b) => b.text).join('\n\n')
}
