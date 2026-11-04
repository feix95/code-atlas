// 线索桌分层:像地图一样一层层放大。纯函数,把整面墙的卡按主题树切成一层层「视野」。
// 每层只画自己这一层:下属主题收成一块块板子(双击飞进去),直属页面照常是卡;
// 只有一张卡的主题不另起板子,直接摆卡;一层里零散页太多就收进「其他页面」板子;
// 某层只剩一块板子、没有别的卡时自动往下跳一层,免得进去还是一块。
import type { WikiWallCard, WikiWallLink } from '../../shared/wikiTypes'

/** 最外层(全景)的层标识 */
export const WALL_TOP_SCOPE = ''
/** 一层里板子加卡超过这么多,就把零散页收进一块板子 */
export const WALL_SCOPE_MAX_ITEMS = 10
/** 板子在墙上用的卡片 id 前缀 */
export const WALL_TILE_PREFIX = 'tile:'
const OVERVIEW_TITLE = '总览'
const MORE_TITLE = '其他页面'

/** 一块板子:进去就是它那一层 */
export interface WallTile {
  key: string
  title: string
  /** 板子里(含更深层)一共几张卡 */
  count: number
  /** 板子的门面卡(主题总览页);没有为 null */
  headId: string | null
  /** 板子里全部卡的 id,连线聚合用 */
  cardIds: string[]
}

/** 一层视野 */
export interface WallScope {
  key: string
  title: string
  /** 上一层;全景为 null */
  parent: string | null
  /** 本层门面卡,摆在正中 */
  headId: string | null
  /** 本层直接摆的卡(含门面卡) */
  cardIds: string[]
  tiles: WallTile[]
}

export interface WallScopeTree {
  scopes: ReadonlyMap<string, WallScope>
  /** 每张卡直接摆在哪一层 */
  scopeOfCard: ReadonlyMap<string, string>
}

interface TopicNode {
  key: string
  title: string
  head: string | null
  leaves: string[]
  children: TopicNode[]
}

function nodeKey(path: readonly string[]): string {
  return path.join('/')
}

function buildForest(cards: readonly WikiWallCard[]): { top: TopicNode[]; roots: string[] } {
  const nodes = new Map<string, TopicNode>()
  const top: TopicNode[] = []
  const ensure = (path: readonly string[]): TopicNode => {
    const key = nodeKey(path)
    let node = nodes.get(key)
    if (node !== undefined) return node
    node = { key, title: path[path.length - 1], head: null, leaves: [], children: [] }
    nodes.set(key, node)
    if (path.length === 1) top.push(node)
    else ensure(path.slice(0, -1)).children.push(node)
    return node
  }
  const roots: string[] = []
  for (const card of cards) {
    if (card.kind === 'root' || card.topicPath.length === 0) {
      roots.push(card.pageId)
      continue
    }
    const node = ensure(card.topicPath)
    if (card.kind === 'overview' && node.head === null) node.head = card.pageId
    else node.leaves.push(card.pageId)
  }
  return { top, roots }
}

function allCards(node: TopicNode): string[] {
  return [
    ...(node.head === null ? [] : [node.head]),
    ...node.leaves,
    ...node.children.flatMap(allCards)
  ]
}

/**
 * 项目名那一层主题(整棵树的伞):它的总览页从属连到别的第一层主题的总览页。
 * 伞本身不是一个板块,并进「总览」板子和项目概述等根主题页放一起。
 */
function umbrellaKeys(top: readonly TopicNode[], links: readonly WikiWallLink[]): Set<string> {
  const headOwner = new Map<string, string>()
  for (const node of top) if (node.head !== null) headOwner.set(node.head, node.key)
  const out = new Set<string>()
  for (const link of links) {
    if (link.kind !== 'contains') continue
    const from = headOwner.get(link.from)
    const to = headOwner.get(link.to)
    if (from !== undefined && to !== undefined && from !== to) out.add(from)
  }
  return out
}

export function buildWallScopes(
  cards: readonly WikiWallCard[],
  links: readonly WikiWallLink[]
): WallScopeTree {
  const { top, roots } = buildForest(cards)
  const umbrellas = umbrellaKeys(top, links)
  const scopes = new Map<string, WallScope>()
  const scopeOfCard = new Map<string, string>()

  const tileOf = (key: string, title: string, ids: string[], headId: string | null): WallTile => ({
    key,
    title,
    count: ids.length,
    headId,
    cardIds: ids
  })
  const addFlat = (key: string, title: string, parent: string, ids: string[]): void => {
    scopes.set(key, { key, title, parent, headId: null, cardIds: ids, tiles: [] })
    for (const id of ids) scopeOfCard.set(id, key)
  }

  /** 摆一层:下属主题成板或成卡,零散页太多收进「其他页面」 */
  const place = (
    key: string,
    title: string,
    parent: string | null,
    headId: string | null,
    leaves: string[],
    children: TopicNode[],
    extraTiles: WallTile[]
  ): void => {
    const tiles = [...extraTiles]
    let loose = [...leaves]
    for (const child of children) {
      const ids = allCards(child)
      if (ids.length === 1) loose.push(ids[0])
      else {
        tiles.push(tileOf(child.key, child.title, ids, child.head))
        place(child.key, child.title, key, child.head, child.leaves, child.children, [])
      }
    }
    if (tiles.length > 0 && loose.length >= 3 && tiles.length + loose.length > WALL_SCOPE_MAX_ITEMS) {
      const moreKey = `${key}/#more`
      tiles.push(tileOf(moreKey, MORE_TITLE, loose, null))
      addFlat(moreKey, MORE_TITLE, key, loose)
      loose = []
    }
    const cardIds = [...(headId === null ? [] : [headId]), ...loose]
    scopes.set(key, { key, title, parent, headId, cardIds, tiles })
    for (const id of cardIds) scopeOfCard.set(id, key)
  }

  // 全景:根主题页与伞主题收进「总览」板子,其余第一层主题各成板子或卡
  const overview = [...roots]
  const children: TopicNode[] = []
  for (const node of top) {
    if (umbrellas.has(node.key)) {
      if (node.head !== null) overview.push(node.head)
      overview.push(...node.leaves)
      children.push(...node.children)
    } else children.push(node)
  }
  const extra: WallTile[] = []
  let topLoose: string[] = []
  if (overview.length >= 2) {
    const key = '#overview'
    extra.push(tileOf(key, OVERVIEW_TITLE, overview, null))
    addFlat(key, OVERVIEW_TITLE, WALL_TOP_SCOPE, overview)
  } else topLoose = overview
  place(WALL_TOP_SCOPE, '全景', null, null, topLoose, children, extra)
  return { scopes, scopeOfCard }
}

/** 落到真正要看的那一层:层不存在回全景;只剩一块板子、没有别的卡就往下跳 */
export function resolveWallScope(tree: WallScopeTree, key: string): string {
  let at = tree.scopes.has(key) ? key : WALL_TOP_SCOPE
  for (let guard = 0; guard < 16; guard += 1) {
    const scope = tree.scopes.get(at)
    if (scope === undefined || scope.tiles.length !== 1) break
    if (scope.cardIds.some((id) => id !== scope.headId)) break
    at = scope.tiles[0].key
  }
  return at
}

/** 顶部路径:从全景到这一层;自动跳过的层不出现 */
export function wallScopeTrail(tree: WallScopeTree, key: string): WallScope[] {
  const trail: WallScope[] = []
  let at: string | null = key
  while (at !== null) {
    const scope = tree.scopes.get(at)
    if (scope === undefined) break
    trail.unshift(scope)
    at = scope.parent
  }
  return trail.filter(
    (scope, i) => i === trail.length - 1 || resolveWallScope(tree, scope.key) === scope.key
  )
}

/** 板子在墙上是一张合成卡:沿用卡片的摆放、拖动、记位置与贴便签 */
function tileCard(tile: WallTile, head: WikiWallCard | undefined): WikiWallCard {
  return {
    pageId: `${WALL_TILE_PREFIX}${tile.key}`,
    kind: 'overview',
    title: tile.title,
    status: head?.status ?? 'planned',
    summary: head?.summary ?? '',
    excerpt: head?.excerpt ?? '',
    file: '',
    keyFiles: [],
    memberCount: tile.count,
    members: [],
    topicPath: []
  }
}

export function isWallTileId(pageId: string): boolean {
  return pageId.startsWith(WALL_TILE_PREFIX)
}

/**
 * 一层要画的卡与线:本层的卡原样,板子换成合成卡;
 * 连线两端各自落到本层的卡或所在板子上,同一对之间的线合成一根,板子内部的线不画。
 */
export function wallScopeView(
  tree: WallScopeTree,
  key: string,
  cards: readonly WikiWallCard[],
  links: readonly WikiWallLink[]
): { cards: WikiWallCard[]; links: WikiWallLink[] } {
  const scope = tree.scopes.get(key)
  if (scope === undefined) return { cards: [], links: [] }
  const byId = new Map(cards.map((card) => [card.pageId, card]))
  const itemOf = new Map<string, string>()
  const out: WikiWallCard[] = []
  for (const id of scope.cardIds) {
    const card = byId.get(id)
    if (card === undefined) continue
    out.push(card)
    itemOf.set(id, id)
  }
  for (const tile of scope.tiles) {
    const synth = tileCard(tile, tile.headId === null ? undefined : byId.get(tile.headId))
    out.push(synth)
    for (const id of tile.cardIds) itemOf.set(id, synth.pageId)
  }
  const merged = new Map<string, WikiWallLink>()
  for (const link of links) {
    const from = itemOf.get(link.from)
    const to = itemOf.get(link.to)
    if (from === undefined || to === undefined || from === to) continue
    const pair = `${from}\n${to}`
    const prev = merged.get(pair)
    if (prev === undefined) {
      merged.set(pair, { from, to, kind: link.kind, weight: link.weight })
    } else if (link.kind === 'reference') {
      const weight = prev.kind === 'reference' ? prev.weight + link.weight : link.weight
      merged.set(pair, { from, to, kind: 'reference', weight })
    }
  }
  return { cards: out, links: [...merged.values()] }
}
