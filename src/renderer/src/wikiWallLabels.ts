// 线索桌卡片的类型与状态文案:卡面、列表视图与读屏标签共用一份。
import type { WikiWallCard } from '../../shared/wikiTypes'

export const WALL_KIND_LABEL: Record<WikiWallCard['kind'], string> = {
  root: '根主题',
  overview: '总览',
  leaf: '主题页'
}

export const WALL_STATUS_LABEL: Record<WikiWallCard['status'], string> = {
  planned: '待生成',
  done: '已生成',
  stale: '已过期',
  failed: '生成失败'
}

/** 卡面摘要:有摘要用摘要,没有就按状态给一句该怎么办 */
export function wallCardBody(card: WikiWallCard): string {
  if (card.summary !== '') return card.summary
  if (card.status === 'failed') return '上次生成没通过,点开看看或重试'
  if (card.kind === 'leaf') return '还没生成 · 点开可以单独生成'
  if (card.keyFiles.length > 0) return card.keyFiles.slice(0, 3).join(' · ')
  return '还没生成'
}
