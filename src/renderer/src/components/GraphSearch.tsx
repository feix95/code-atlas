// 关系图谱顶栏的搜索框:标签、名称、简介与路径统一入口。
// 下拉里方向键换项、Enter 定位、Esc 收起;未生成 Wiki 时只按程序名与路径匹配并提示。
import { TreeIcon } from './Icons'
import type { RefObject } from 'react'
import type { GraphSearchState } from '../graph/useGraphSearch'
import type { SearchMatch, WikiSearchHit } from '../graph/wikiSearch'

const MATCH_LABEL: Record<SearchMatch, string> = {
  tag: '标签',
  name: '名称',
  summary: '简介',
  path: '路径'
}

export interface GraphSearchProps {
  search: GraphSearchState
  inputRef: RefObject<HTMLInputElement | null>
  /** 选中一条结果:切到所属文件夹并选中文件 */
  onLocate: (hit: WikiSearchHit) => void
}

export function GraphSearch({ search, inputRef, onLocate }: GraphSearchProps): React.JSX.Element {
  const activeId =
    search.open && search.hits.length > 0 ? `graph-search-hit-${search.activeIndex}` : undefined

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      search.openList()
      search.moveActive(e.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (e.key === 'Enter') {
      const hit = search.hits[search.activeIndex]
      if (!search.open || hit === undefined) return
      e.preventDefault()
      e.stopPropagation()
      search.closeList()
      onLocate(hit)
      return
    }
    if (e.key !== 'Escape') return
    if (search.open) {
      e.preventDefault()
      e.stopPropagation()
      search.closeList()
    } else if (search.query !== '') {
      e.preventDefault()
      e.stopPropagation()
      search.setQuery('')
    }
  }

  const onBlur = (e: React.FocusEvent<HTMLDivElement>): void => {
    const next = e.relatedTarget
    if (next instanceof Node && e.currentTarget.contains(next)) return
    search.closeList()
  }

  return (
    <div className="graph-search" onKeyDown={onKeyDown} onBlur={onBlur}>
      <div className="graph-search-field">
        <TreeIcon name="search" size={14} mono />
        <input
          ref={inputRef}
          className="graph-search-input"
          value={search.query}
          role="combobox"
          aria-label="搜索图谱"
          aria-autocomplete="list"
          aria-expanded={search.open}
          aria-controls="graph-search-results"
          aria-activedescendant={activeId}
          placeholder="搜索标签、模块、简介或路径"
          onChange={(e) => search.setQuery(e.target.value)}
          onFocus={search.openList}
        />
        {search.query !== '' && (
          <button
            type="button"
            className="graph-search-clear"
            aria-label="清除搜索"
            onClick={() => {
              search.setQuery('')
              search.focusInput()
            }}
          >
            <TreeIcon name="x" size={12} mono />
          </button>
        )}
      </div>
      {search.open && (
        <div
          className="graph-search-results"
          id="graph-search-results"
          role="listbox"
          aria-label="搜索结果"
        >
          {search.hits.length === 0 ? (
            <p className="graph-search-empty">没有匹配的模块或文件</p>
          ) : (
            search.hits.map((hit, index) => (
              <button
                key={hit.pageId}
                id={`graph-search-hit-${index}`}
                type="button"
                role="option"
                aria-selected={index === search.activeIndex}
                className={`graph-search-hit${index === search.activeIndex ? ' is-active' : ''}`}
                onMouseEnter={() => search.setActiveIndex(index)}
                onClick={() => {
                  search.closeList()
                  onLocate(hit)
                }}
              >
                <span className="graph-search-hit-main">{hit.name}</span>
                <span className="graph-search-hit-note">
                  {MATCH_LABEL[hit.match]} ·{' '}
                  {hit.kind === 'module'
                    ? '模块'
                    : hit.kind === 'group'
                      ? '散件组'
                      : hit.kind === 'overview'
                        ? '总览'
                        : hit.kind === 'root'
                          ? '根主题'
                          : '主题页'}{' '}
                  · {hit.files.length} 个文件
                </span>
                {hit.match !== 'name' && (
                  <span className="graph-search-hit-why">{hit.matched}</span>
                )}
              </button>
            ))
          )}
          {!search.hasWiki && <p className="graph-search-hint">生成 Wiki 后可按标签与说明搜索</p>}
        </div>
      )}
    </div>
  )
}
