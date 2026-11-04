// 线索桌分层后的一块板子:代表下一层主题,画成一叠钉在一起的纸。
// 单击选中(有总览页就打开它的详情),双击飞进这一层;位置与拖动跟卡片一样由上层管。
import type { WallPlacedCard } from '../wikiWallLayout'

export function WikiWallTileView({
  placed,
  selected,
  dim,
  dragging,
  onSelect,
  onEnter,
  onHover,
  onDragStart
}: {
  placed: WallPlacedCard
  selected: boolean
  dim: boolean
  dragging: boolean
  onSelect: () => void
  onEnter: () => void
  onHover: (on: boolean) => void
  onDragStart: (event: React.PointerEvent<HTMLElement>, placed: WallPlacedCard) => void
}): React.JSX.Element {
  const card = placed.card
  return (
    <button
      type="button"
      className={`wiki-wall-tile${selected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${
        dragging ? ' is-dragging' : ''
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
      aria-label={`${card.title} · ${card.memberCount} 张卡 · 双击进入`}
      aria-pressed={selected}
      data-tile-id={card.pageId}
      title="双击进入这一层"
      onClick={onSelect}
      onDoubleClick={onEnter}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        onEnter()
      }}
      onPointerDown={(event) => onDragStart(event, placed)}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
    >
      <span className="wiki-wall-pin" aria-hidden="true" />
      <span className="wiki-wall-tile-title">{card.title}</span>
      <span className="wiki-wall-tile-count">{card.memberCount} 张卡</span>
      {card.summary !== '' && <span className="wiki-wall-tile-body">{card.summary}</span>}
      <span className="wiki-wall-tile-hint" aria-hidden="true">
        双击进入 ›
      </span>
    </button>
  )
}
