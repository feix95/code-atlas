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
      // 只写文件名的按文件名定位;写全路径的必须能在规划内找到
      const located = span.includes('/')
        ? memberPaths.has(span) || planPaths.has(span)
        : basenames.has(span)
      if (!located) violations.push(span)
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(span) && /[A-Z]/.test(span)) {
      if (!allowedIdents.has(span)) violations.push(span)
    }
  }
  return [...new Set(violations)]
}

/** 行内代码配平:模型偶尔漏写右反引号,整行奇数个时在行尾补一个,不动代码围栏行 */
export function balanceInlineCode(text: string): string {
  let inFence = false
  return text
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      const count = (line.match(/`/g) ?? []).length
      return count % 2 === 1 ? `${line}\`` : line
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
