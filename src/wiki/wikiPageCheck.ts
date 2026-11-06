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

/** 粘连修复时认得出真名的集合:成员与规划文件的全路径与文件名,加证据内全部符号名 */
export function knownNamesOf(evidence: WikiPageEvidence, planPaths: Set<string>): Set<string> {
  const names = new Set<string>()
  for (const p of [...evidence.files.map((f) => f.path), ...planPaths]) {
    names.add(p)
    names.add(p.split('/').pop() ?? p)
  }
  for (const file of evidence.files) {
    for (const range of file.symbolRanges) names.add(range.name)
    for (const name of file.structure?.exports ?? []) names.add(name)
    for (const name of file.structure?.functions ?? []) names.add(name)
    for (const name of file.structure?.classes ?? []) names.add(name)
    for (const name of file.structure?.interfaces ?? []) names.add(name)
  }
  return names
}

/**
 * 从粘连内容里抢救真名:以已知名称开头就把名称重新包上反引号,余下留作正文;
 * 两个已知名称直接相连时中间补顿号。抢救不出任何名称返回 null。
 */
function rescueGlued(content: string, sortedNames: string[]): string | null {
  let out = ''
  let rest = content
  let prevWasName = false
  while (rest !== '') {
    const hit = sortedNames.find((name) => rest.startsWith(name))
    if (hit === undefined) break
    out += `${prevWasName ? '、' : ''}\`${hit}\``
    rest = rest.slice(hit.length)
    prevWasName = true
  }
  return prevWasName ? out + rest : null
}

/**
 * 行内代码修复:模型偶尔漏写右反引号,使路径与后面的中文粘成一整段假代码。
 * 逐行处理:内容粘连的片段先按已知名称抢救真名,抢救不出才拆掉反引号(文字保留);
 * 行尾未闭合的片段,内容像代码就补上右反引号,像正文就抢救或拆掉左反引号。
 * 不动代码围栏行。
 */
export function balanceInlineCode(text: string, knownNames?: Set<string>): string {
  const sortedNames =
    knownNames === undefined
      ? null
      : [...knownNames].filter((n) => n !== '').sort((a, b) => b.length - a.length)
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
      let out = ''
      let cursor = 0
      let changed = false
      for (let k = 0; k + 1 < ticks.length; k += 2) {
        const open = ticks[k]!
        const close = ticks[k + 1]!
        const content = line.slice(open + 1, close)
        out += line.slice(cursor, open)
        if (isCodeSpan(content)) {
          out += line.slice(open, close + 1)
        } else {
          const rescued = sortedNames !== null ? rescueGlued(content, sortedNames) : null
          out += rescued ?? content
          changed = true
        }
        cursor = close + 1
      }
      if (ticks.length % 2 === 1) {
        const last = ticks[ticks.length - 1]!
        const trailing = line.slice(last + 1)
        out += line.slice(cursor, last)
        if (isCodeSpan(trailing)) {
          out += `\`${trailing}\``
        } else {
          const rescued = sortedNames !== null ? rescueGlued(trailing, sortedNames) : null
          out += rescued ?? trailing
        }
        changed = true
        cursor = line.length
      }
      out += line.slice(cursor)
      return changed ? out : line
    })
    .join('\n')
}

/** C4 程序依赖图:节点为非附属成员,边为页内引用,边数上限 20 保可读 */
export function mermaidOf(evidence: WikiPageEvidence): string {
  const nodes = evidence.files.filter((f) => f.role !== 'attached' && f.role !== 'reference')
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
