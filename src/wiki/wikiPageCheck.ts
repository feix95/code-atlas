// 正文的程序侧校验与拼装件:标识符白名单(C6)、行内代码配平、程序依赖图(C4)。
// 全部是确定性程序逻辑,不调用模型。
import type { WikiPageEvidence } from './wikiReadTypes.ts'

/** C6 白名单:路径必须能在规划内定位;大写开头的标识符必须在本页证据内 */
export function checkWhitelist(
  text: string,
  evidence: WikiPageEvidence,
  planPaths: Set<string>
): string[] {
  const allowedIdents = new Set<string>()
  for (const file of evidence.files) {
    for (const range of file.symbolRanges) allowedIdents.add(range.name)
    for (const name of file.structure?.exports ?? []) allowedIdents.add(name)
    for (const name of file.structure?.functions ?? []) allowedIdents.add(name)
    for (const name of file.structure?.classes ?? []) allowedIdents.add(name)
    for (const name of file.structure?.interfaces ?? []) allowedIdents.add(name)
  }
  const memberPaths = new Set(evidence.files.map((f) => f.path))
  const basenames = new Set([...memberPaths, ...planPaths].map((p) => p.split('/').pop() ?? p))
  const violations: string[] = []
  for (const match of text.matchAll(/`([^`]{1,120})`/g)) {
    const span = match[1]!.trim()
    if (span.includes('/') || /\.(ts|tsx|js|jsx|json|md|css|py|go|rs)$/.test(span)) {
      // 只写文件名的按文件名定位;写全路径的必须能在规划内找到;
      // 写目录的,只要是某个成员或规划文件的所在目录前缀,也算定位成功
      const dirPrefix = `${span.replace(/\/?$/, '')}/`
      const located = span.includes('/')
        ? memberPaths.has(span) ||
          planPaths.has(span) ||
          [...memberPaths, ...planPaths].some((p) => p.startsWith(dirPrefix))
        : basenames.has(span)
      if (!located) violations.push(span)
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(span) && /[A-Z]/.test(span)) {
      if (!allowedIdents.has(span)) violations.push(span)
    }
  }
  return [...new Set(violations)]
}

/** 代码片段合法内容:纯 ASCII 且无空白(标识符、路径、简单签名);含中文或空格即属正文粘连 */
function isCodeSpan(content: string): boolean {
  return content !== '' && !/\s/.test(content) && !/[^\x20-\x7E]/.test(content)
}

/**
 * 行内代码修复:模型偶尔漏写右反引号,使路径与后面的中文粘成一整段假代码。
 * 逐行处理:内容粘连的片段拆掉它的反引号(文字保留);行尾未闭合的片段,
 * 内容像代码就补上右反引号,像正文就拆掉左反引号。不动代码围栏行。
 */
export function balanceInlineCode(text: string): string {
  let inFence = false
  return text
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        inFence = !inFence
        return line
      }
      if (inFence || !line.includes('`')) return line
      const ticks: number[] = []
      for (let i = 0; i < line.length; i++) if (line[i] === '`') ticks.push(i)
      const drop = new Set<number>()
      let appendClose = false
      for (let k = 0; k + 1 < ticks.length; k += 2) {
        const content = line.slice(ticks[k]! + 1, ticks[k + 1]!)
        if (!isCodeSpan(content)) {
          drop.add(ticks[k]!)
          drop.add(ticks[k + 1]!)
        }
      }
      if (ticks.length % 2 === 1) {
        const last = ticks[ticks.length - 1]!
        if (isCodeSpan(line.slice(last + 1))) appendClose = true
        else drop.add(last)
      }
      if (drop.size === 0 && !appendClose) return line
      const kept = [...line].filter((_, i) => !drop.has(i)).join('')
      return appendClose ? `${kept}\`` : kept
    })
    .join('\n')
}

/** C4 程序依赖图:节点为非附属成员,边为页内引用,边数上限 20 保可读 */
export function mermaidOf(evidence: WikiPageEvidence): string {
  const nodes = evidence.files.filter((f) => f.role !== 'attached')
  const idOf = new Map(nodes.map((f, i) => [f.path, `f${i}`]))
  const lines = ['```mermaid', 'flowchart LR']
  for (const file of nodes) {
    const label = file.path.split('/').pop()!.replace(/"/g, "'")
    lines.push(`  ${idOf.get(file.path)}["${label}"]`)
  }
  const seen = new Set<string>()
  for (const edge of evidence.internalEdges) {
    if (!idOf.has(edge.from) || !idOf.has(edge.to)) continue
    const key = `${edge.from}->${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    if (seen.size > 20) break
    lines.push(`  ${idOf.get(edge.from)} --> ${idOf.get(edge.to)}`)
  }
  lines.push('```')
  return lines.join('\n')
}
