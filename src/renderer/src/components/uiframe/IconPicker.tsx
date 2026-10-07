// 图标选择器(第 10 节,M3-e 补全):分类页签 + 中英文搜索 + 最近使用 + 自定义 SVG。
// 一次只画有限个,避免 1800+ 图标一起上屏;自定义图标渲染消毒后的原文。
import { createElement, useMemo, useState } from 'react'
import {
  CUSTOM_ICON_PREFIX,
  customKey,
  isCustomIcon,
  isCustomIconName,
  sanitizeSvgIcon
} from '@shared/uiFrame/customIcon'
import { ICON_CATEGORIES, iconCategory, iconSearch } from '@shared/uiFrame/iconCatalog'
import type { IconNode } from '@shared/uiFrame/types'
import { ICON_NAMES, iconLookup, iconTags } from '../../uiFrame/assets'

/** 每页显示的图标个数 */
const PAGE_SIZE = 96
/** 最近使用名单上限与存根 */
const RECENT_KEY = 'codeatlas.uiframe.recentIcons'
const RECENT_MAX = 12

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

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
  custom,
  onPick,
  onCustom
}: {
  current: string
  /** doc.customIcons:custom:<名> → svg 文本;给「自定义」区与导出入口用 */
  custom: Record<string, string>
  onPick: (name: string) => void
  /** 自定义 svg 入库(名字 + 消毒文本),由调用方落 doc.customIcons 并把槽位指过去 */
  onCustom: (name: string, svg: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [cat, setCat] = useState<string>('all')
  const [recent, setRecent] = useState<string[]>(readRecent)
  const [customErr, setCustomErr] = useState<string | null>(null)

  const searching = query.trim() !== ''
  const matches = useMemo(() => {
    let list = iconSearch(query, ICON_NAMES, iconTags)
    if (!searching && cat !== 'all') list = list.filter((n) => iconCategory(n) === cat)
    return list
  }, [query, cat, searching])
  const shown = matches.slice(0, limit)

  const pick = (name: string): void => {
    setRecent(() => {
      const next = [name, ...readRecent().filter((n) => n !== name)].slice(0, RECENT_MAX)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // 存不上不挡选图标
      }
      return next
    })
    onPick(name)
  }

  const importSvg = async (): Promise<void> => {
    setCustomErr(null)
    try {
      const f = await window.atlas.uiFrameImportFile('svg')
      if (!f) return
      const base = f.name.replace(/\.svg$/i, '') || 'custom'
      if (!isCustomIconName(base)) {
        setCustomErr('图标文件名不合法:请用中英文、数字、横线、下划线(40 字内)')
        return
      }
      const svg = sanitizeSvgIcon(f.text)
      onCustom(base, svg)
    } catch (err) {
      setCustomErr(err instanceof Error ? err.message : String(err))
    }
  }

  const renderCell = (name: string): React.JSX.Element | null => {
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
        onClick={() => pick(name)}
      >
        <LucideGlyph node={node} />
      </button>
    )
  }

  return (
    <div className="uf-icon-picker">
      <input
        className="uf-input"
        type="search"
        value={query}
        placeholder="搜索图标(英文名、关键词或中文)"
        aria-label="搜索图标"
        onChange={(e) => {
          setQuery(e.target.value)
          setLimit(PAGE_SIZE)
        }}
      />
      {!searching && (
        <div className="uf-icon-cats" role="tablist" aria-label="图标分类">
          {[{ id: 'all', label: '全部' }, ...ICON_CATEGORIES].map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={cat === c.id}
              className={`uf-cat${cat === c.id ? ' is-on' : ''}`}
              onClick={() => {
                setCat(c.id)
                setLimit(PAGE_SIZE)
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <p className="uf-hint">
        当前:<code>{current}</code> · 共 {matches.length} 个
      </p>
      {!searching && cat === 'all' && recent.length > 0 && (
        <>
          <p className="uf-part-sub">最近使用</p>
          <div className="uf-icon-grid" role="listbox" aria-label="最近使用">
            {recent.map((name) => renderCell(name))}
          </div>
        </>
      )}
      {matches.length === 0 ? (
        <p className="uf-hint">没有找到匹配的图标,换个关键词试试(中英文都行)。</p>
      ) : (
        <div className="uf-icon-grid" role="listbox" aria-label="图标">
          {shown.map((name) => renderCell(name))}
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
      <div className="uf-icon-custom">
        <p className="uf-part-sub">自定义图标</p>
        <div className="uf-icon-grid" role="listbox" aria-label="自定义图标">
          {Object.entries(custom).map(([name, svg]) => (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={current === `${CUSTOM_ICON_PREFIX}${name}`}
              className={`uf-icon-cell${
                current === `${CUSTOM_ICON_PREFIX}${name}` ? ' is-on' : ''
              }`}
              data-tip={`${CUSTOM_ICON_PREFIX}${name}`}
              onClick={() => pick(`${CUSTOM_ICON_PREFIX}${name}`)}
              // 文本已在导入时被 sanitizeSvgIcon 消毒(剥脚本/事件/外链)
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ))}
          <button
            type="button"
            className="uf-icon-cell uf-icon-import"
            title="导入一个 .svg 文件当作图标"
            onClick={() => void importSvg()}
          >
            +
          </button>
        </div>
        {customErr && <p className="uf-hint uf-err">{customErr}</p>}
        {isCustomIcon(current) && (
          <p className="uf-hint">当前用的是自定义图标「{customKey(current)}」。</p>
        )}
      </div>
    </div>
  )
}
