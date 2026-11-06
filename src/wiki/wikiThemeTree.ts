// 把原子页装进骨架章,替换按目录前缀搭树。
// 有目录缓存就用缓存里的章和页名;没有、或缓存对不上,就用确定性聚类。
import { byCodeUnit } from '../modules/pathOrder.ts'
import type { DepEdge } from '../shared/types.ts'
import type { WikiCatalog } from './wikiCatalogStore.ts'
import { resolveCatalog } from './wikiCatalogStore.ts'
import { CHAPTERS, type SkeletonChapter } from './wikiSkeleton.ts'
import { shortHash } from './wikiPlanTree.ts'
import {
  PLAN_THEME_MAX_DEPTH,
  type WikiChannelUse,
  type WikiPlanInput,
  type WikiPlanPage,
  type WikiPlanTopic
} from './wikiPlanTypes.ts'
import { affinityEdges, atomsFromPages, type ThemeAtom } from './wikiThemeAtoms.ts'
import {
  clusterPlacements,
  humanLeafTitle,
  humanTitle,
  type AtomPlacement
} from './wikiThemeCluster.ts'
import { placementsFromCatalog } from './wikiThemeCatalog.ts'

const CHAPTER_ORDER = ['architecture', 'features', 'components', 'api', 'tests']

interface TopicNode {
  topic: WikiPlanTopic
  order: number
}

function chapterRank(slug: string): number {
  const index = CHAPTER_ORDER.indexOf(slug)
  return index < 0 ? CHAPTER_ORDER.length : index
}

function blankTopic(
  dir: string,
  title: string,
  kind: WikiPlanTopic['kind'],
  slug: string,
  order: number
): TopicNode {
  return {
    order,
    topic: {
      id: `t:${shortHash(dir || '.')}`,
      title,
      dir,
      kind,
      slug,
      overviewPageId: null,
      pageIds: [],
      children: []
    }
  }
}

function nearestPlacement(
  atom: ThemeAtom,
  edges: DepEdge[],
  placed: Map<string, AtomPlacement>
): AtomPlacement | null {
  const score = new Map<string, number>()
  for (const edge of edges) {
    const other = edge.from === atom.id ? edge.to : edge.to === atom.id ? edge.from : null
    if (other === null || !placed.has(other)) continue
    score.set(other, (score.get(other) ?? 0) + 1)
  }
  const best = [...score.entries()].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))[0]
  return best ? (placed.get(best[0]) ?? null) : null
}

function withMissing(
  atoms: ThemeAtom[],
  placements: AtomPlacement[],
  fileEdges: DepEdge[],
  atomEdges: DepEdge[],
  hubs: Set<string>,
  channelUses: readonly WikiChannelUse[],
  open: Set<string>
): AtomPlacement[] {
  const placed = new Map(placements.map((place) => [place.atomId, place]))
  const missing = atoms.filter((atom) => !placed.has(atom.id))
  const fallback = clusterPlacements(missing, fileEdges, hubs, channelUses, open)
  const byFallback = new Map(fallback.map((place) => [place.atomId, place]))
  for (const atom of atoms) {
    if (placed.has(atom.id)) continue
    const near = nearestPlacement(atom, atomEdges, placed)
    const spare = byFallback.get(atom.id)
    const place = near ?? spare
    if (place && place !== spare) {
      placed.set(atom.id, {
        ...place,
        atomId: atom.id,
        title: null,
        prompt: null,
        section: null,
        sectionTitle: null
      })
    } else if (spare) {
      placed.set(atom.id, spare)
    } else {
      placed.set(atom.id, {
        atomId: atom.id,
        chapter: 'features',
        theme: null,
        themeTitle: null,
        section: null,
        sectionTitle: null,
        title: null,
        prompt: null
      })
    }
  }
  return atoms.map((atom) => placed.get(atom.id)!)
}

function uniquify(pages: WikiPlanPage[], themeTitle: Map<string, string>): void {
  const seen = new Map<string, number>()
  for (const page of pages) {
    const count = seen.get(page.title) ?? 0
    seen.set(page.title, count + 1)
    if (count === 0) continue
    const prefix = themeTitle.get(page.id)
    const base = page.members
      .find((member) => member.role === 'primary')
      ?.path.split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '')
    const next =
      prefix && !page.title.startsWith(prefix)
        ? `${prefix} · ${page.title}`
        : `${page.title} · ${base ?? count + 1}`
    page.title = count > 1 ? `${next} ${count}` : next
    seen.set(next, (seen.get(next) ?? 0) + 1)
  }
}

/**
 * 组装主题树。缓存能用就用;不能用就聚类。
 * 子项不少于 2 的主题生成总览页,成员只引用、不占归属。
 */
export function assembleThemeTopics(
  input: WikiPlanInput,
  atoms: WikiPlanPage[],
  skeletonChapters: SkeletonChapter[],
  skeletonLeaves: WikiPlanPage[],
  edges: DepEdge[],
  hubs: Set<string>,
  catalog: WikiCatalog | null
): { topics: WikiPlanTopic[]; overviewPages: WikiPlanPage[] } {
  const atomModels = atomsFromPages(atoms)
  const open = new Set(skeletonChapters.map((chapter) => chapter.slug))
  open.add(CHAPTERS.features.slug)
  const channelUses = input.channelUses ?? []
  const resolved = resolveCatalog(
    catalog,
    atomModels.map((atom) => ({
      atomId: atom.id,
      membersKey: [...atom.primary].sort().join('\n')
    }))
  )
  const fromCatalog = resolved ? placementsFromCatalog(resolved, atomModels, open) : null
  const seed = fromCatalog ?? clusterPlacements(atomModels, edges, hubs, channelUses, open)
  const atomEdges = affinityEdges(atomModels, edges, hubs, channelUses)
  const placements = withMissing(atomModels, seed, edges, atomEdges, hubs, channelUses, open)
  const placeOf = new Map(placements.map((place) => [place.atomId, place]))
  const themeTitle = new Map<string, string>()

  for (const page of atoms) {
    const place = placeOf.get(page.id)
    if (!place) continue
    if (place.title && place.title.trim() !== '') page.title = place.title
    else page.title = humanLeafTitle(page)
    if (place.prompt) page.writingPrompt = place.prompt
    if (place.themeTitle) themeTitle.set(page.id, place.themeTitle)
  }
  for (const page of skeletonLeaves) {
    if (!/[\u4e00-\u9fff]/.test(page.title)) page.title = humanTitle(page.title)
  }
  uniquify([...atoms, ...skeletonLeaves], themeTitle)

  const nodes = new Map<string, TopicNode>()
  const ensure = (
    dir: string,
    title: string,
    kind: WikiPlanTopic['kind'],
    slug: string,
    order: number
  ): TopicNode => {
    let node = nodes.get(dir)
    if (!node) {
      node = blankTopic(dir, title, kind, slug, order)
      nodes.set(dir, node)
    }
    return node
  }
  for (const chapter of skeletonChapters) {
    ensure(chapter.slug, chapter.title, 'skeleton', chapter.slug, chapterRank(chapter.slug))
  }
  const depthOk = (dir: string): boolean => dir.split('/').length <= PLAN_THEME_MAX_DEPTH

  const attach = (
    page: WikiPlanPage,
    chapter: string,
    theme: string | null,
    themeName: string | null,
    section: string | null,
    sectionName: string | null
  ): void => {
    const chapterNode = ensure(
      chapter,
      skeletonChapters.find((item) => item.slug === chapter)?.title ?? CHAPTERS.features.title,
      'skeleton',
      chapter,
      chapterRank(chapter)
    )
    let parent = chapterNode
    let dir = chapter
    if (theme && themeName && depthOk(`${dir}/${theme}`)) {
      dir = `${dir}/${theme}`
      parent = ensure(dir, themeName, 'theme', theme, parent.order)
    }
    if (section && sectionName && depthOk(`${dir}/${section}`)) {
      dir = `${dir}/${section}`
      parent = ensure(dir, sectionName, 'section', section, parent.order)
    }
    parent.topic.pageIds.push(page.id)
    page.topicId = parent.topic.id
  }

  for (const page of skeletonLeaves) {
    const chapter = skeletonChapters.find((item) => item.pageIds.includes(page.id))
    attach(page, chapter?.slug ?? CHAPTERS.features.slug, null, null, null, null)
  }
  for (const page of atoms) {
    const place = placeOf.get(page.id)!
    attach(page, place.chapter, place.theme, place.themeTitle, place.section, place.sectionTitle)
  }

  const topics = [...nodes.values()]
    .map((node) => node.topic)
    .filter(
      (topic) =>
        topic.pageIds.length > 0 ||
        [...nodes.values()].some((other) => other.topic.dir.startsWith(`${topic.dir}/`))
    )
  const byDir = new Map(topics.map((topic) => [topic.dir, topic]))
  const roots: WikiPlanTopic[] = []
  for (const topic of topics) {
    const slash = topic.dir.lastIndexOf('/')
    if (slash < 0) {
      roots.push(topic)
      continue
    }
    const parent = byDir.get(topic.dir.slice(0, slash))
    if (parent) parent.children.push(topic)
    else roots.push(topic)
  }
  const overviewPages: WikiPlanPage[] = []
  const ordered = [...topics].sort((a, b) => byCodeUnit(a.dir, b.dir))
  for (const topic of ordered) {
    topic.pageIds.sort(byCodeUnit)
    topic.children.sort(
      (a, b) =>
        chapterRank(a.slug ?? a.dir) - chapterRank(b.slug ?? b.dir) || byCodeUnit(a.dir, b.dir)
    )
    if (topic.pageIds.length + topic.children.length < 2) continue
    const refs = topic.pageIds
      .map((id) => [...atoms, ...skeletonLeaves].find((page) => page.id === id))
      .flatMap(
        (page) =>
          page?.members
            .filter((member) => member.role === 'primary')
            .map((member) => member.path) ?? []
      )
      .slice(0, 12)
    const overview: WikiPlanPage = {
      id: `w:${shortHash(`${topic.dir}|overview`)}`,
      kind: 'overview',
      topicDir: null,
      title: topic.title,
      anchorDir: topic.dir,
      anchorSymbol: null,
      topicId: topic.id,
      members: refs.map((path) => ({ path, role: 'reference' })),
      evidenceTokens: 0,
      oversized: false,
      basis: ['子页总览']
    }
    topic.overviewPageId = overview.id
    overviewPages.push(overview)
  }
  roots.sort(
    (a, b) =>
      chapterRank(a.slug ?? a.dir) - chapterRank(b.slug ?? b.dir) || byCodeUnit(a.title, b.title)
  )
  return { topics: roots, overviewPages }
}
