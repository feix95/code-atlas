// 原子页的一行摘要,以及原子之间的亲和边。
// 三种边相加:去掉公共文件后的引用、共用的公共导出成员、文件名里的功能词。
// 摘要只含仓库内相对路径,绝不带本机绝对路径。
import type { DepEdge } from '../shared/types.ts'
import { nameTokens } from './wikiPlanFeatures.ts'
import type { WikiChannelUse, WikiPlanPage } from './wikiPlanTypes.ts'
import { isShellPath } from './wikiSkeleton.ts'

/** 同一个功能词出现在这么多原子里才连边;再多就是通用词,连上会把全仓粘成一团 */
export const TOKEN_MIN_ATOMS = 2
export const TOKEN_MAX_ATOMS = 8
/** 同一个通道成员最多串起这么多个原子 */
export const CONTRACT_MAX_ATOMS = 6
/** 一条文件引用换成一条原子边 */
export const IMPORT_COPIES = 1
/** 共用一个导出成员比一条普通引用更像跨进程的同一个功能 */
export const CONTRACT_COPIES = 2

const GENERIC_TOKENS = new Set([
  'src',
  'lib',
  'app',
  'dist',
  'build',
  'components',
  'component',
  'hooks',
  'hook',
  'utils',
  'util',
  'common',
  'shared',
  'core',
  'main',
  'index',
  'test',
  'tests',
  'scripts',
  'node',
  'use',
  'get',
  'set'
])

export interface ThemeAtom {
  id: string
  title: string
  primary: string[]
  feature: string | null
  anchorDir: string
  anchorSymbol: string | null
  symbols: string[]
  reactFiles: number
  shellFiles: number
}

export function membersKeyOf(paths: readonly string[]): string {
  return [...paths].sort().join('\n')
}

export function atomsFromPages(pages: WikiPlanPage[]): ThemeAtom[] {
  return pages.map((page) => {
    const primary = page.members
      .filter((member) => member.role === 'primary')
      .map((member) => member.path)
    const feature = page.topicDir?.startsWith('feature:')
      ? page.topicDir.slice('feature:'.length)
      : null
    return {
      id: page.id,
      title: page.title,
      primary,
      feature,
      anchorDir: page.anchorDir,
      anchorSymbol: page.anchorSymbol,
      symbols: page.anchorSymbol ? [page.anchorSymbol] : [],
      reactFiles: primary.filter((path) => path.endsWith('.tsx')).length,
      shellFiles: primary.filter((path) => isShellPath(path)).length
    }
  })
}

/** 给模型看的一行:标识、程序名、最多五个短路径、最多五个符号。不含绝对路径。 */
export function atomBrief(atom: ThemeAtom, blurb = ''): string {
  const paths = atom.primary.slice(0, 5).join(',')
  const symbols = atom.symbols.slice(0, 5).join(',')
  return [atom.id, atom.title, paths, symbols, blurb].filter((part) => part !== '').join('\t')
}

function fileAtom(primaryOf: Map<string, string>, file: string): string | undefined {
  return primaryOf.get(file)
}

function addCopies(bag: Map<string, number>, from: string, to: string, copies: number): void {
  if (from === to || copies <= 0) return
  const [a, b] = from < to ? [from, to] : [to, from]
  const key = `${a}\n${b}`
  bag.set(key, (bag.get(key) ?? 0) + copies)
}

/**
 * 原子亲和边(允许重复,条数就是权重)。
 * 引用边去掉公共文件;通道成员每个键最多连 CONTRACT_MAX_ATOMS 个原子;功能词只在 2 到 8 个原子里出现时才连。
 */
export function affinityEdges(
  atoms: ThemeAtom[],
  edges: DepEdge[],
  hubs: Set<string>,
  channelUses: readonly WikiChannelUse[]
): DepEdge[] {
  const primaryOf = new Map<string, string>()
  for (const atom of atoms) for (const path of atom.primary) primaryOf.set(path, atom.id)
  const weight = new Map<string, number>()
  for (const edge of edges) {
    if (hubs.has(edge.from) || hubs.has(edge.to)) continue
    const from = fileAtom(primaryOf, edge.from)
    const to = fileAtom(primaryOf, edge.to)
    if (from === undefined || to === undefined) continue
    addCopies(weight, from, to, IMPORT_COPIES)
  }
  const byKey = new Map<string, Set<string>>()
  for (const use of channelUses) {
    const atom = fileAtom(primaryOf, use.file)
    if (atom === undefined) continue
    const key = `${use.hub}#${use.member}`
    const set = byKey.get(key) ?? new Set<string>()
    set.add(atom)
    byKey.set(key, set)
  }
  for (const ids of byKey.values()) {
    const picked = [...ids].sort().slice(0, CONTRACT_MAX_ATOMS)
    for (let i = 0; i < picked.length; i++) {
      for (let j = i + 1; j < picked.length; j++)
        addCopies(weight, picked[i]!, picked[j]!, CONTRACT_COPIES)
    }
  }
  const tokenAtoms = new Map<string, Set<string>>()
  for (const atom of atoms) {
    const tokens = new Set<string>()
    if (atom.feature) tokens.add(atom.feature)
    for (const path of atom.primary) for (const token of nameTokens(path)) tokens.add(token)
    for (const token of tokens) {
      if (GENERIC_TOKENS.has(token)) continue
      const set = tokenAtoms.get(token) ?? new Set<string>()
      set.add(atom.id)
      tokenAtoms.set(token, set)
    }
  }
  for (const ids of tokenAtoms.values()) {
    if (ids.size < TOKEN_MIN_ATOMS || ids.size > TOKEN_MAX_ATOMS) continue
    const picked = [...ids].sort()
    for (let i = 0; i < picked.length; i++) {
      for (let j = i + 1; j < picked.length; j++) addCopies(weight, picked[i]!, picked[j]!, 1)
    }
  }
  const out: DepEdge[] = []
  for (const [key, copies] of weight) {
    const [from, to] = key.split('\n') as [string, string]
    for (let n = 0; n < copies; n++) out.push({ from, to })
  }
  return out
}

export function edgeCopies(edges: DepEdge[], from: string, to: string): number {
  const [a, b] = from < to ? [from, to] : [to, from]
  return edges.filter((edge) => {
    const [x, y] = edge.from < edge.to ? [edge.from, edge.to] : [edge.to, edge.from]
    return x === a && y === b
  }).length
}
