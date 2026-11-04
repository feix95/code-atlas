// 文件与卡片墙的归属反查:叶子卡的正经成员优先,只有父卡收录时如实标为收录。
// 文件夹按后代文件聚合出覆盖它的卡,按覆盖数排序。
import type { WikiWallCard } from '@shared/wikiTypes'
import type { GroupTree } from '@shared/hierarchy'

export interface WikiCardOwner {
  card: WikiWallCard
  /** member = 叶子卡的正经成员;included = 只被总览或根主题页收录 */
  via: 'member' | 'included'
}

export function cardOwnerOf(cards: readonly WikiWallCard[], file: string): WikiCardOwner | null {
  let included: WikiWallCard | null = null
  for (const card of cards) {
    if (!card.members.includes(file)) continue
    if (card.kind === 'leaf') return { card, via: 'member' }
    if (included === null) included = card
  }
  return included === null ? null : { card: included, via: 'included' }
}

export interface WikiCardCoverage {
  card: WikiWallCard
  /** 这张卡覆盖的文件数(按传入的文件清单数) */
  count: number
}

export function cardsForFiles(
  cards: readonly WikiWallCard[],
  files: readonly string[]
): WikiCardCoverage[] {
  const wanted = new Set(files)
  const result: WikiCardCoverage[] = []
  for (const card of cards) {
    let count = 0
    for (const member of card.members) if (wanted.has(member)) count += 1
    if (count > 0) result.push({ card, count })
  }
  return result.sort((a, b) => b.count - a.count || a.card.title.localeCompare(b.card.title))
}

/** 文件夹在扫描树里的全部后代文件路径 */
export function descendantFilesOf(tree: GroupTree, folderId: string): string[] {
  const files: string[] = []
  const walk = (id: string): void => {
    for (const child of tree.children(id)) {
      if (tree.kindOf(child) === 'file') files.push(child)
      else walk(child)
    }
  }
  if (tree.has(folderId)) walk(folderId)
  return files
}
