// 线索桌的列表视图:卡多了桌面看不过来时,按团分组一行一张,点一行同样打开右侧详情。
import { useMemo } from 'react'
import type { WikiWallCard } from '@shared/wikiTypes'
import { wallGroupTitle } from '../wikiWallLayout'
import { WALL_KIND_LABEL, WALL_STATUS_LABEL, wallCardBody } from '../wikiWallLabels'

export function WikiWallList({
  cards,
  selectedId,
  onSelect
}: {
  cards: WikiWallCard[]
  selectedId: string | null
  onSelect: (pageId: string) => void
}): React.JSX.Element {
  const groups = useMemo(() => {
    const map = new Map<string, WikiWallCard[]>()
    for (const card of cards) {
      const title = wallGroupTitle(card)
      const list = map.get(title)
      if (list === undefined) map.set(title, [card])
      else list.push(card)
    }
    return [...map.entries()]
  }, [cards])

  return (
    <div className="wiki-wall-list">
      {groups.map(([title, members]) => (
        <section key={title} className="wiki-wall-list-group" aria-label={title}>
          <h3>
            {title}
            <small>{members.length} 张</small>
          </h3>
          <ul>
            {members.map((card) => (
              <li key={card.pageId}>
                <button
                  type="button"
                  className={`wiki-wall-list-row is-${card.status}${
                    selectedId === card.pageId ? ' is-selected' : ''
                  }`}
                  aria-pressed={selectedId === card.pageId}
                  onClick={() => onSelect(card.pageId)}
                >
                  <span className="wiki-wall-list-title">{card.title}</span>
                  <span className="wiki-wall-list-body">{wallCardBody(card)}</span>
                  <span className="wiki-wall-list-meta">
                    {WALL_KIND_LABEL[card.kind]} · {card.memberCount} 个文件
                  </span>
                  <span className={`wiki-wall-list-status is-${card.status}`}>
                    {WALL_STATUS_LABEL[card.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
