// 线索桌桌面:点阵纸上摆卡、挂线绳、贴区名胶带;可以拖卡、拖空白处平移、滚轮缩放。
// 手动拖过的卡位置按项目记在本机,没拖过的卡继续跟自动布局走;缩小到一定程度只留标题。
import { useCallback, useMemo, useRef, useState } from 'react'
import type { WikiWallCard, WikiWallLink } from '@shared/wikiTypes'
import { layoutWikiWall, wallNeighbors, type WallPlacedCard } from '../wikiWallLayout'
import { applyWallPositions, nextWallZ } from '../wikiWallPositions'
import { setWallPositions, useWallPositions } from '../wikiWallBoardStore'
import { WALL_FAR_ZOOM, WALL_ZOOM_MAX, WALL_ZOOM_MIN } from '../wikiWallViewport'
import { useWallViewport } from '../useWallViewport'
import { useWallCardDrag } from '../useWallCardDrag'
import { useWallStickerBoard } from '../useWallStickerBoard'
import { WikiWallCardView } from './WikiWallCardView'

const ZOOM_STEP = 1.25

export function WikiWallBoard({
  rootPath,
  cards,
  links,
  ready,
  selectedId,
  onSelect
}: {
  rootPath: string
  cards: WikiWallCard[]
  links: WikiWallLink[]
  ready: boolean
  selectedId: string | null
  onSelect: (pageId: string | null) => void
}): React.JSX.Element {
  const base = useMemo(() => layoutWikiWall(cards, links), [cards, links])
  const positions = useWallPositions(rootPath)
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewport = useWallViewport(scrollRef, base.width, base.height, ready && cards.length > 0)
  const { view } = viewport
  // 点阵间距跟着缩放走,缩得很小时隔一个点取一个,免得满屏密点发花
  const dot = 24 * view.z * (view.z < 0.5 ? 2 : 1)

  const commit = useCallback(
    (pageId: string, x: number, y: number) => {
      setWallPositions(rootPath, { ...positions, [pageId]: { x, y, z: nextWallZ(positions) } })
    },
    [rootPath, positions]
  )
  const drag = useWallCardDrag(view.z, commit)

  const layout = useMemo(() => {
    const { draft } = drag
    const merged =
      draft === null
        ? positions
        : { ...positions, [draft.id]: { x: draft.x, y: draft.y, z: nextWallZ(positions) } }
    return applyWallPositions(base, merged, links)
  }, [base, positions, links, drag])
  // 用户便签与图片:画在桌面里,贴在卡上的跟着卡走;整理桌面不动它们
  const stickers = useWallStickerBoard({ rootPath, cards: layout.cards, view, hostRef: scrollRef })

  const [hoverId, setHoverId] = useState<string | null>(null)
  const focusId = drag.draft?.id ?? hoverId ?? selectedId
  const near = useMemo(
    () => (focusId === null ? null : wallNeighbors(links, focusId)),
    [links, focusId]
  )
  const nudge = (placed: WallPlacedCard, dx: number, dy: number): void =>
    commit(placed.card.pageId, Math.max(0, placed.x + dx), Math.max(0, placed.y + dy))

  return (
    <div
      ref={scrollRef}
      className={`wiki-wall-scroll${view.z < WALL_FAR_ZOOM ? ' is-far' : ''}`}
      style={{
        backgroundPosition: `${view.x}px ${view.y}px, 0 0`,
        backgroundSize: `${dot}px ${dot}px, auto`
      }}
      onPointerDown={(event) => viewport.onPanStart(event, () => onSelect(null))}
    >
      <div
        className={`wiki-wall-board${near !== null ? ' has-focus' : ''}`}
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`
        }}
      >
        <svg
          className="wiki-wall-lines"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          {layout.links.map((placed, index) => {
            const hot =
              focusId !== null && (placed.link.from === focusId || placed.link.to === focusId)
            return (
              <path
                key={index}
                d={placed.d}
                className={`wiki-wall-line is-${placed.link.kind} is-${placed.tier}${hot ? ' is-hot' : ''}`}
              />
            )
          })}
        </svg>
        {layout.regions.map((region) => (
          <span
            key={region.title || 'no-topic'}
            className="wiki-wall-tape"
            style={{
              left: region.tapeX,
              top: region.tapeY,
              transform: `rotate(${region.tilt}deg)`
            }}
          >
            {region.title || '未归类'}
            <small>{region.count} 张</small>
          </span>
        ))}
        {layout.cards.map((placed) => (
          <WikiWallCardView
            key={placed.card.pageId}
            placed={placed}
            selected={selectedId === placed.card.pageId}
            dim={near !== null && !near.has(placed.card.pageId)}
            dragging={drag.draft?.id === placed.card.pageId}
            onSelect={(pageId) => {
              if (!drag.consumeClick()) onSelect(pageId)
            }}
            onHover={(pageId, on) => setHoverId((id) => (on ? pageId : id === pageId ? null : id))}
            onDragStart={(event, p) => drag.start(event, { id: p.card.pageId, x: p.x, y: p.y })}
            onNudge={nudge}
          />
        ))}
        {stickers.layer}
      </div>
      {stickers.tools}
      <div
        className="wiki-wall-zoom"
        role="group"
        aria-label="缩放"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="缩小"
          disabled={view.z <= WALL_ZOOM_MIN}
          onClick={() => viewport.setZoom(view.z / ZOOM_STEP)}
        >
          −
        </button>
        <button type="button" aria-label="恢复 100%" onClick={() => viewport.setZoom(1)}>
          {Math.round(view.z * 100)}%
        </button>
        <button
          type="button"
          aria-label="放大"
          disabled={view.z >= WALL_ZOOM_MAX}
          onClick={() => viewport.setZoom(view.z * ZOOM_STEP)}
        >
          +
        </button>
        <button type="button" onClick={viewport.fit}>
          看全部
        </button>
      </div>
    </div>
  )
}
