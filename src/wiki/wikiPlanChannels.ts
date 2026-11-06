// 从源码里抽出「用了哪个公共导出的哪个成员」,给跨进程契约亲和边用。
// 只读已经引用了公共文件的那些源码,并且只认该文件确实引用的那个公共文件的导出。
import type { DepEdge } from '../shared/types.ts'
import { findPlanHubs } from './wikiPlanHubs.ts'
import type { WikiChannelUse, WikiPlanFileInput } from './wikiPlanTypes.ts'

const MEMBER = /\b[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)\b/g
const SKIP = new Set([
  'default',
  'prototype',
  'then',
  'catch',
  'length',
  'name',
  'map',
  'push',
  'filter'
])

export async function collectChannelUses(
  files: WikiPlanFileInput[],
  edges: DepEdge[],
  readText: (relPath: string) => Promise<string | null>
): Promise<WikiChannelUse[]> {
  const hubs = findPlanHubs(files)
  if (hubs.size === 0) return []
  const exportsOf = new Map<string, Set<string>>()
  for (const file of files) {
    if (!hubs.has(file.relPath) || file.exports.length === 0) continue
    exportsOf.set(file.relPath, new Set(file.exports))
  }
  if (exportsOf.size === 0) return []
  const hubsOf = new Map<string, string[]>()
  for (const edge of edges) {
    if (!exportsOf.has(edge.to)) continue
    const list = hubsOf.get(edge.from)
    if (list) list.push(edge.to)
    else hubsOf.set(edge.from, [edge.to])
  }
  const uses: WikiChannelUse[] = []
  const seen = new Set<string>()
  const importers = [...hubsOf.keys()].sort().slice(0, 500)
  for (const file of importers) {
    const text = await readText(file)
    if (text === null) continue
    const names = new Set<string>()
    MEMBER.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = MEMBER.exec(text)) !== null) {
      const member = match[1]!
      if (!SKIP.has(member)) names.add(member)
    }
    for (const hub of hubsOf.get(file) ?? []) {
      const exported = exportsOf.get(hub)
      if (!exported) continue
      for (const member of names) {
        if (!exported.has(member)) continue
        const key = `${file}\n${hub}\n${member}`
        if (seen.has(key)) continue
        seen.add(key)
        uses.push({ file, hub, member })
      }
    }
  }
  return uses
}
