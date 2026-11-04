// 线索桌上的一张卡:按页类型画成纸条、索引卡或档案夹,带图钉、盖章与过期胶带。
// 只管画和把点击、悬停交给上层;位置与角度由布局算好传进来。
import type { WikiWallCard } from '@shared/wikiTypes'
import type { WallPlacedCard } from '../wikiWallLayout'

const KIND_LABEL: Record<WikiWallCard['kind'], string> = {
  root: '根主题',
  overview: '总览',
  leaf: '主题页'
}

const STATUS_LABEL: Record<WikiWallCard['status'], string> = {
  planned: '待生成',
  done: '已生成',
  stale: '已过期',
  failed: '生成失败'
}

/** 卡面上的盖章文字:已生成盖「已归档」、失败盖红章;过期改用斜贴的黄胶带 */
const STAMP_LABEL: Partial<Record<WikiWallCard['status'], string>> = {
  done: '已归档',
  failed: '生成失败'
}

function cardBody(card: WikiWallCard): string {
  if (card.summary !== '') return card.summary
  if (card.status === 'failed') return '上次生成没通过,点开看看或重试'
  if (card.kind === 'leaf') return '还没生成 · 点开可以单独生成'
  if (card.keyFiles.length > 0) return card.keyFiles.slice(0, 3).join(' · ')
  return '还没生成'
}

export function WikiWallCardView({
  placed,
  selected,
  dim,
  onSelect,
  onHover
}: {
  placed: WallPlacedCard
  selected: boolean
  dim: boolean
  onSelect: (pageId: string) => void
  onHover: (pageId: string, on: boolean) => void
}): React.JSX.Element {
  const card = placed.card
  const stamp = STAMP_LABEL[card.status]
  return (
    <button
      type="button"
      className={`wiki-wall-card is-${card.kind} is-${card.status}${selected ? ' is-selected' : ''}${
        dim ? ' is-dim' : ''
      }`}
      style={
        {
          left: placed.x,
          top: placed.y,
          width: placed.w,
          height: placed.h,
          '--tilt': `${placed.tilt}deg`
        } as React.CSSProperties
      }
      aria-label={`${card.title} · ${KIND_LABEL[card.kind]} · ${STATUS_LABEL[card.status]}`}
      aria-pressed={selected}
      onClick={() => onSelect(card.pageId)}
      onMouseEnter={() => onHover(card.pageId, true)}
      onMouseLeave={() => onHover(card.pageId, false)}
      onFocus={() => onHover(card.pageId, true)}
      onBlur={() => onHover(card.pageId, false)}
    >
      {card.kind !== 'root' && <span className="wiki-wall-pin" aria-hidden="true" />}
      <span className="wiki-wall-card-kind">
        {KIND_LABEL[card.kind]}
        {card.kind === 'overview' && card.topicPath.length > 0
          ? ` · ${card.topicPath.join(' / ')}`
          : ''}
      </span>
      <span className="wiki-wall-card-title">{card.title}</span>
      <span className="wiki-wall-card-body">{cardBody(card)}</span>
      <span className="wiki-wall-card-foot">
        <span>{card.memberCount} 个文件</span>
        {card.kind !== 'leaf' && <span>{STATUS_LABEL[card.status]}</span>}
      </span>
      {stamp !== undefined && card.kind === 'leaf' && (
        <span className={`wiki-wall-stamp is-${card.status}`} aria-hidden="true">
          {stamp}
        </span>
      )}
      {card.status === 'stale' && (
        <span className="wiki-wall-stale-tape" aria-hidden="true">
          已过期 · 待更新
        </span>
      )}
    </button>
  )
}
