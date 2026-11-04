// 线索桌的线绳层:近景画卡与卡的从属线、引用线(焦点相关的点亮);
// 远景只画岛与岛之间的聚合线,粗细按引用条数、换算成屏幕像素,缩多远都一样粗。
import { useMemo } from 'react'
import type { WikiWallLink } from '@shared/wikiTypes'
import type { WikiWallLayout } from '../wikiWallLayout'
import { wallIslandLinks } from '../wikiWallIslandLinks'

export function WikiWallLines({
  layout,
  links,
  far,
  zoom,
  focusId
}: {
  layout: WikiWallLayout
  links: WikiWallLink[]
  far: boolean
  zoom: number
  focusId: string | null
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
              style={{ strokeWidth: line.width / zoom }}
            >
              <title>{`${line.from} ↔ ${line.to}:${line.count} 条引用`}</title>
            </path>
          ))
        : layout.links.map((placed, index) => {
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
  )
}
