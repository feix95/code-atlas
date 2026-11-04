// 线索桌的线绳层:近景画卡与卡的从属线、引用线(焦点相关的点亮);
// 远景只画岛与岛之间的聚合线:一律同一粗细、换算成屏幕像素,缩多远都一样粗;条数在悬停提示里。
import { useMemo } from 'react'
import type { WikiWallLink } from '@shared/wikiTypes'
import type { WikiWallLayout } from '../wikiWallLayout'
import { WALL_ISLAND_LINE_PX, wallIslandLinks } from '../wikiWallIslandLinks'
import { wallLineTouches, type WallRect } from '../wikiWallCull'

export function WikiWallLines({
  layout,
  links,
  far,
  zoom,
  focusId,
  cull
}: {
  layout: WikiWallLayout
  links: WikiWallLink[]
  far: boolean
  zoom: number
  focusId: string | null
  /** 近景的视口裁剪范围:碰不到的线不画(点亮的照画);null = 全画 */
  cull: WallRect | null
}): React.JSX.Element {
  const islandLinks = useMemo(
    () => (far ? wallIslandLinks(layout.cards, links) : []),
    [far, layout.cards, links]
  )
  return (
    <svg className="wiki-wall-lines" width={layout.width} height={layout.height} aria-hidden="true">
      {far
        ? islandLinks.map((line) => (
            <path
              key={`${line.from}\n${line.to}`}
              d={line.d}
              className="wiki-wall-island-line"
              style={{ strokeWidth: WALL_ISLAND_LINE_PX / zoom }}
            >
              <title>{`${line.from} ↔ ${line.to}:${line.count} 条引用`}</title>
            </path>
          ))
        : layout.links.map((placed, index) => {
            const hot =
              focusId !== null && (placed.link.from === focusId || placed.link.to === focusId)
            if (cull !== null && !hot && !wallLineTouches(placed, cull)) return null
            return (
              <path
                key={index}
                d={placed.d}
                className={`wiki-wall-line is-${placed.link.kind} is-${placed.tier}${hot ? ' is-hot' : ''}`}
              />
            )
          })}
    </svg>
  )
}
