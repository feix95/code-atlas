// 线索桌上的一张卡:按页类型画成纸条、索引卡或档案夹,带图钉、盖章与过期胶带。
// 只管画,点击、悬停、按下拖动与方向键挪动都交给上层;位置与角度由布局算好传进来。
import type { WikiWallCard } from '@shared/wikiTypes'
import type { WallPlacedCard } from '../wikiWallLayout'
import {
  WALL_KIND_LABEL as KIND_LABEL,
  WALL_STATUS_LABEL as STATUS_LABEL,
  wallCardBody as cardBody
} from '../wikiWallLabels'

/** 卡面上的盖章文字:已生成盖「已归档」、失败盖红章;过期改用斜贴的黄胶带 */
const STAMP_LABEL: Partial<Record<WikiWallCard['status'], string>> = {
  done: '已归档',
  failed: '生成失败'
}

/** 选中卡片后方向键挪动:每次 10 像素,按住 Shift 40 像素 */
const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
}

export function WikiWallCardView({
  placed,
  selected,
  dim,
  dragging,
  onSelect,
  onHover,
  onDragStart,
  onNudge
}: {
  placed: WallPlacedCard
  selected: boolean
  dim: boolean
  dragging: boolean
  onSelect: (pageId: string) => void
  onHover: (pageId: string, on: boolean) => void
  onDragStart: (event: React.PointerEvent<HTMLElement>, placed: WallPlacedCard) => void
  onNudge: (placed: WallPlacedCard, dx: number, dy: number) => void
}): React.JSX.Element {
  const card = placed.card
  const stamp = STAMP_LABEL[card.status]
  return (
    <button
      type="button"
      className={`wiki-wall-card is-${card.kind} is-${card.status}${selected ? ' is-selected' : ''}${
        dim ? ' is-dim' : ''
      }${dragging ? ' is-dragging' : ''}`}
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
      onPointerDown={(event) => onDragStart(event, placed)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10
        const delta = NUDGE[event.key]
        if (delta === undefined) return
        event.preventDefault()
        onNudge(placed, delta[0] * step, delta[1] * step)
      }}
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
