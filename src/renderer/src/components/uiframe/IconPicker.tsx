// lucide 图标选择器(§10):按名称与标签搜索,点选即换;一次只画有限个,避免 1800+ 图标一起上屏。
import { createElement, useMemo, useState } from 'react'
import type { IconNode } from '@shared/uiFrame/types'
import { ICON_NAMES, iconLookup, iconTags } from '../../uiFrame/assets'

/** 每页显示的图标个数 */
const PAGE_SIZE = 96

export function LucideGlyph({
  node,
  size = '1.25rem'
}: {
  node: IconNode
  size?: string
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {node.map(([tag, attrs], i) => createElement(tag, { ...attrs, key: i }))}
    </svg>
  )
}

export function IconPicker({
  current,
  onPick
}: {
  current: string
  onPick: (name: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ICON_NAMES
    return ICON_NAMES.filter(
      (n) => n.includes(q) || iconTags(n).some((t) => t.toLowerCase().includes(q))
    )
  }, [query])
  const shown = matches.slice(0, limit)

  return (
    <div className="uf-icon-picker">
      <input
        className="uf-input"
        type="search"
        value={query}
        placeholder="搜索图标(英文名或关键词)"
        aria-label="搜索图标"
        onChange={(e) => {
          setQuery(e.target.value)
          setLimit(PAGE_SIZE)
        }}
      />
      <p className="uf-hint">
        当前:<code>{current}</code> · 共 {matches.length} 个
      </p>
      {matches.length === 0 ? (
        <p className="uf-hint">没有找到匹配的图标,换个英文关键词试试。</p>
      ) : (
        <div className="uf-icon-grid" role="listbox" aria-label="图标">
          {shown.map((name) => {
            const node = iconLookup(name)
            if (!node) return null
            return (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={name === current}
                className={`uf-icon-cell${name === current ? ' is-on' : ''}`}
                data-tip={name}
                onClick={() => onPick(name)}
              >
                <LucideGlyph node={node} />
              </button>
            )
          })}
        </div>
      )}
      {matches.length > limit && (
        <button
          type="button"
          className="btn btn-ghost uf-more"
          onClick={() => setLimit((n) => n + PAGE_SIZE)}
        >
          再显示 {Math.min(PAGE_SIZE, matches.length - limit)} 个(还剩 {matches.length - limit} 个)
        </button>
      )}
    </div>
  )
}
