// 图谱搜索的界面状态:查询、下拉当前项、命中集合与输入框引用。
// 匹配纯本地;画布高亮与结果定位由调用方接到渲染与导航上。
import { useCallback, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import {
  SEARCH_RESULTS_MAX,
  focusOfHits,
  normalizeSearchText,
  searchWikiCards,
  searchWikiPages,
  type SearchFocus,
  type WikiSearchHit
} from './wikiSearch'
import type { WikiWallCard } from '@shared/wikiTypes'
import type { WikiPanelData } from '../useWikiPanel'

export interface GraphSearchState {
  query: string
  /** 规范化后的查询词;空串 = 没有搜索 */
  term: string
  hits: WikiSearchHit[]
  /** 下拉当前项;没有结果时为 0 */
  activeIndex: number
  open: boolean
  /** 命中页的成员与模块;没有命中为 null */
  focus: SearchFocus | null
  /** 当前语种至少有一篇已生成的 Wiki */
  hasWiki: boolean
  setQuery: (value: string) => void
  focusInput: () => void
  /** 侧栏点标签:把标签填进搜索框并聚焦 */
  searchTag: (tag: string) => void
  openList: () => void
  closeList: () => void
  setActiveIndex: (index: number) => void
  moveActive: (delta: number) => void
}

export function useGraphSearch(
  wiki: WikiPanelData | null,
  inputRef: RefObject<HTMLInputElement | null>,
  cards?: readonly WikiWallCard[]
): GraphSearchState {
  const [query, setQueryState] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const term = normalizeSearchText(query)
  const hasCards = cards !== undefined && cards.length > 0

  const hits = useMemo(() => {
    if (term === '') return []
    // 卡片墙数据在手时只认第二版页面;还没读到墙时才回退旧页搜索
    if (hasCards) return searchWikiCards(term, cards).slice(0, SEARCH_RESULTS_MAX)
    if (wiki === null) return []
    const entries = wiki.sources.map((source) => ({
      source,
      page: wiki.pages.get(source.pageId) ?? null
    }))
    return searchWikiPages(term, entries).slice(0, SEARCH_RESULTS_MAX)
  }, [term, wiki, cards, hasCards])

  const activeIndex = hits.length === 0 ? 0 : Math.min(active, hits.length - 1)
  const focus = useMemo(() => (hits.length > 0 ? focusOfHits(hits) : null), [hits])

  const hasWiki = useMemo(() => {
    if (hasCards) return cards.some((card) => card.status === 'done' || card.status === 'stale')
    if (wiki === null) return false
    for (const page of wiki.pages.values()) if (page.status !== 'none') return true
    return false
  }, [wiki, cards, hasCards])

  const setQuery = useCallback((value: string) => {
    setQueryState(value)
    setActive(0)
    setOpen(normalizeSearchText(value) !== '')
  }, [])

  const focusInput = useCallback(() => {
    const input = inputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }, [inputRef])

  const searchTag = useCallback(
    (tag: string) => {
      setQueryState(tag)
      setActive(0)
      setOpen(true)
      inputRef.current?.focus()
    },
    [inputRef]
  )

  const openList = useCallback(() => {
    if (term !== '') setOpen(true)
  }, [term])

  const closeList = useCallback(() => setOpen(false), [])

  const moveActive = useCallback(
    (delta: number) => {
      setActive((current) => {
        if (hits.length === 0) return 0
        const base = Math.min(current, hits.length - 1)
        return (base + delta + hits.length) % hits.length
      })
    },
    [hits.length]
  )

  return {
    query,
    term,
    hits,
    activeIndex,
    open,
    focus,
    hasWiki,
    setQuery,
    focusInput,
    searchTag,
    openList,
    closeList,
    setActiveIndex: setActive,
    moveActive
  }
}
