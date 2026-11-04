// 便签/图片底部的「跟着某某」一行。平时只是展示;进入编辑后,已关联的前面多一个小叉可以取消,
// 没关联的给一个「＋ 关联卡片」,点开是能搜标题的卡片小列表。只管显示和收点击,改存档交给上层的 onLink。
import { useEffect, useRef, useState } from 'react'

export interface WallLinkCard {
  pageId: string
  title: string
}

interface LinkProps {
  hostTitle: string | null
  editing: boolean
  cards: readonly WallLinkCard[]
  onLink: (pageId: string | null) => void
}

/** 列表里最多列这么多张,再多就靠搜 */
const LIST_MAX = 50

/** 按下、点击、双击都不往外冒:不触发拖动、选中和进入编辑 */
const stop = (event: React.SyntheticEvent): void => event.stopPropagation()

export function WikiWallStickerLink(props: LinkProps): React.JSX.Element | null {
  const { hostTitle, editing, onLink } = props
  if (hostTitle !== null) {
    return (
      <span className="wiki-wall-sticker-meta is-linked">
        {editing && (
          <button
            type="button"
            className="wiki-wall-link-x"
            aria-label="取消关联"
            title="取消关联"
            onPointerDown={stop}
            onDoubleClick={stop}
            onClick={(event) => {
              event.stopPropagation()
              onLink(null)
            }}
          >
            <svg viewBox="0 0 10 10" width="7" height="7" aria-hidden="true">
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        )}
        <span className="wiki-wall-link-name">📎 跟着「{hostTitle}」</span>
      </span>
    )
  }
  // 只在编辑时挂上,退出编辑就连同展开状态一起卸掉
  return editing ? <LinkAdd {...props} /> : null
}

function LinkAdd({ cards, onLink }: LinkProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="wiki-wall-link" onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <button
        type="button"
        className="wiki-wall-link-add"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ＋ 关联卡片
      </button>
      {open && (
        <LinkPicker
          cards={cards}
          onClose={() => setOpen(false)}
          onPick={(pageId) => {
            setOpen(false)
            onLink(pageId)
          }}
        />
      )}
    </div>
  )
}

function LinkPicker({
  cards,
  onPick,
  onClose
}: {
  cards: readonly WallLinkCard[]
  onPick: (pageId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLUListElement>(null)
  // 桌面在外层手挂了滚轮缩放;列表里滚动时拦住,只滚列表不缩放桌面
  useEffect(() => {
    const el = listRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => event.stopPropagation()
    el.addEventListener('wheel', onWheel)
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const key = query.trim().toLowerCase()
  const hits = cards
    .filter((c) => key === '' || c.title.toLowerCase().includes(key))
    .slice(0, LIST_MAX)
  return (
    <div className="wiki-wall-link-pop" role="dialog" aria-label="选一张卡片关联">
      <input
        className="wiki-wall-link-search"
        autoFocus
        value={query}
        placeholder="搜卡片标题…"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
          if (event.key === 'Enter' && hits.length > 0) onPick(hits[0].pageId)
        }}
      />
      <ul ref={listRef} className="wiki-wall-link-list">
        {hits.length === 0 ? (
          <li className="wiki-wall-link-empty">没有对得上的卡片</li>
        ) : (
          hits.map((card) => (
            <li key={card.pageId}>
              <button type="button" onClick={() => onPick(card.pageId)}>
                {card.title}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
