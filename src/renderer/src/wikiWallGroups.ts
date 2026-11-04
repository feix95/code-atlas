// 线索桌分岛口径:纯函数,按主题树第一层(章)成岛,大章再按第二层(节)拆成几座岛。
// 桌面摆岛、区名胶带与列表视图分组都读这一份,保证三处一致。
import type { WikiWallCard } from '../../shared/wikiTypes'

/** 根主题区的固定名字;根主题卡没有主题链 */
export const WALL_ROOT_REGION = '总览'
/** 没有主题链的卡归这里 */
export const WALL_UNGROUPED = '未归类'
/** 一章超过这么多张卡才拆岛:一座岛太大,一屏里找不到东西 */
export const WALL_CHAPTER_SPLIT_FROM = 18
/** 拆岛时,不足这么多张卡的节留在章岛里,不单独成一座小岛 */
export const WALL_SECTION_MIN_CARDS = 3

function chapterOf(card: WikiWallCard): string {
  if (card.kind === 'root') return WALL_ROOT_REGION
  return card.topicPath[0] ?? WALL_UNGROUPED
}

function sectionOf(card: WikiWallCard): string | null {
  if (card.kind === 'root' || card.topicPath.length < 2) return null
  return card.topicPath.slice(0, 2).join(' / ')
}

function countBy(
  cards: WikiWallCard[],
  keyOf: (card: WikiWallCard) => string | null
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const card of cards) {
    const key = keyOf(card)
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * 每张卡所在岛的名字(页标识 → 岛名)。根主题归「总览」;其余按主题链第一段成章;
 * 章内卡数超过门槛时按前两段拆节,太小的节和章自己的总览卡留在章岛。
 */
export function wallGroupTitles(cards: WikiWallCard[]): Map<string, string> {
  const chapterCount = countBy(cards, chapterOf)
  const sectionCount = countBy(cards, sectionOf)
  const titles = new Map<string, string>()
  for (const card of cards) {
    const chapter = chapterOf(card)
    const section = sectionOf(card)
    const splits = (chapterCount.get(chapter) ?? 0) > WALL_CHAPTER_SPLIT_FROM
    const bigSection =
      section !== null && (sectionCount.get(section) ?? 0) >= WALL_SECTION_MIN_CARDS
    titles.set(card.pageId, splits && bigSection ? section : chapter)
  }
  return titles
}
