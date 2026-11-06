// 没有模型时的主题兜底:在原子亲和图上做社区发现,再按信号把簇放进骨架章。
// 主题名取簇里最常见的功能词;说不出功能词就留在章下,不再用目录前缀当岛名。
import { detectCommunities } from '../modules/communities.ts'
import { byCodeUnit } from '../modules/pathOrder.ts'
import type { DepEdge, ModuleParams } from '../shared/types.ts'
import { translateName } from '../summarizer/words.ts'
import { nameTokens } from './wikiPlanFeatures.ts'
import { CHAPTERS, type ChapterSlug } from './wikiSkeleton.ts'
import { PLAN_HUB_MIN_IN_DEGREE, PLAN_HUB_SHARE, type WikiPlanPage } from './wikiPlanTypes.ts'
import { affinityEdges, type ThemeAtom } from './wikiThemeAtoms.ts'

const GENERIC = new Set([
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
  'file',
  'data',
  'use',
  'get',
  'set'
])

export interface AtomPlacement {
  atomId: string
  chapter: string
  theme: string | null
  themeTitle: string | null
  section: string | null
  sectionTitle: string | null
  title: string | null
  prompt: string | null
}

function params(resolution: number): ModuleParams {
  return {
    resolution,
    seed: 42,
    folderAffinity: 0,
    minFiles: 1,
    hubMinInDegree: PLAN_HUB_MIN_IN_DEGREE,
    hubShare: PLAN_HUB_SHARE
  }
}

/** 社区发现按路径分目录锚点。原子标识不是路径,套一层各自的目录,避免被锚点粘成一团。 */
function clusterIds(ids: string[], edges: DepEdge[], resolution: number): string[][] {
  if (ids.length === 0) return []
  const wrapped = ids.map((id) => `atoms/${id}/node`)
  const back = new Map(wrapped.map((path, index) => [path, ids[index]!]))
  const wrappedEdges = edges.map((edge) => ({
    from: `atoms/${edge.from}/node`,
    to: `atoms/${edge.to}/node`
  }))
  const inDegree = new Map(wrapped.map((path) => [path, 0]))
  return detectCommunities(wrapped, wrappedEdges, inDegree, params(resolution)).map((group) =>
    group.map((path) => back.get(path)!)
  )
}

export function humanTitle(raw: string): string {
  const direct = translateName(raw)
  if (direct) return direct
  const parts = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9\u4e00-\u9fff]+/)
    .filter((part) => part !== '')
  const translated = parts
    .map((part) => translateName(part) ?? (GENERIC.has(part.toLowerCase()) ? '' : part))
    .filter((part) => part !== '')
  return translated.length > 0 ? translated.join('') : raw
}

/** 程序名是目录通词(src、components)时,改用符号或文件名,免得卡片还叫文件夹 */
export function humanLeafTitle(page: WikiPlanPage): string {
  if (!GENERIC.has(page.title.toLowerCase())) return humanTitle(page.title)
  if (page.anchorSymbol) {
    const named = humanTitle(page.anchorSymbol)
    if (!GENERIC.has(named.toLowerCase()) && named !== page.anchorSymbol) return named
    if (page.anchorSymbol.length >= 4 && !GENERIC.has(page.anchorSymbol.toLowerCase()))
      return page.anchorSymbol
  }
  const file = page.members
    .find((member) => member.role === 'primary')
    ?.path.split('/')
    .pop()
    ?.replace(/\.[^.]+$/, '')
  if (file && !GENERIC.has(file.toLowerCase())) return humanTitle(file)
  const parent = page.anchorDir
    .split('/')
    .filter((segment) => segment !== '' && !GENERIC.has(segment.toLowerCase()))
    .pop()
  if (parent) return humanTitle(parent)
  return page.title
}

function chapterOf(atom: ThemeAtom, open: Set<string>): ChapterSlug {
  if (atom.feature) return 'features'
  const size = Math.max(atom.primary.length, 1)
  if (open.has('components') && atom.reactFiles * 2 >= size) return 'components'
  if (open.has('architecture') && atom.shellFiles * 2 >= size) return 'architecture'
  return 'features'
}

function labelOf(atoms: ThemeAtom[]): string | null {
  const score = new Map<string, number>()
  for (const atom of atoms) {
    if (atom.feature) score.set(atom.feature, (score.get(atom.feature) ?? 0) + 3)
    for (const path of atom.primary) {
      for (const token of nameTokens(path)) {
        if (GENERIC.has(token)) continue
        score.set(token, (score.get(token) ?? 0) + 1)
      }
    }
  }
  const best = [...score.entries()].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))[0]
  return best ? best[0] : null
}

/**
 * 确定性归类。功能词原子即使落单也保留自己的主题名(并进别的主题会把不相干功能粘死);
 * 说不出名字的落单原子直接挂在章下,不另起一座只有一张卡的岛。
 */
export function clusterPlacements(
  atoms: ThemeAtom[],
  fileEdges: DepEdge[],
  hubs: Set<string>,
  channelUses: readonly { file: string; hub: string; member: string }[],
  openChapters: Set<string>
): AtomPlacement[] {
  if (atoms.length === 0) return []
  const edges = affinityEdges(atoms, fileEdges, hubs, channelUses)
  let groups = clusterIds(
    atoms.map((atom) => atom.id),
    edges,
    1
  )
  const byId = new Map(atoms.map((atom) => [atom.id, atom]))
  const next: string[][] = []
  for (const group of groups) {
    if (group.length <= 12) {
      next.push(group)
      continue
    }
    const inner = new Set(group)
    const sub = clusterIds(
      group,
      edges.filter((edge) => inner.has(edge.from) && inner.has(edge.to)),
      1.4
    )
    next.push(...(sub.length >= 2 ? sub : [group]))
  }
  groups = next
  const placements: AtomPlacement[] = []
  const usedSlugs = new Set<string>()
  groups.forEach((group, index) => {
    const members = group.map((id) => byId.get(id)!).filter((atom) => atom !== undefined)
    const token = labelOf(members)
    const counts = new Map<ChapterSlug, number>()
    for (const atom of members) {
      const chapter = chapterOf(atom, openChapters)
      counts.set(chapter, (counts.get(chapter) ?? 0) + 1)
    }
    const chapter =
      [...counts.entries()].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))[0]?.[0] ??
      'features'
    const keepTheme =
      token !== null && (members.length >= 2 || members.some((atom) => atom.feature === token))
    let slug: string | null = null
    let title: string | null = null
    if (keepTheme && token) {
      slug = token.toLowerCase()
      while (usedSlugs.has(`${chapter}/${slug}`)) slug = `${slug}-${index}`
      usedSlugs.add(`${chapter}/${slug}`)
      title = humanTitle(token)
    }
    for (const atom of members) {
      placements.push({
        atomId: atom.id,
        chapter: CHAPTERS[chapter].slug,
        theme: slug,
        themeTitle: title,
        section: null,
        sectionTitle: null,
        title: null,
        prompt: null
      })
    }
  })
  return placements
}
