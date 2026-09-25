// 工作区文件名深搜(UI v3 §7.2)的词↔账钩子:防抖 200ms 后主进程起搜,
// seq 顶掉旧一轮(本端扔旧账,主进程那边也被新一轮顶掉收工回 cancelled)。
// 结果按词对齐存账:清单的「搜索中/命中数」由 存的账.q === 当前词 推导,
// 词一换旧账即刻不算数 —— 不用在 effect 里同步 setState(react-hooks 闸)。
import { useEffect, useRef, useState } from 'react'
import type { SearchNameHit } from '@shared/searchNames'

/** 输入防抖:键入连成一片时只走最后一拍 */
const SEARCH_DEBOUNCE_MS = 200

/** 按词存账:q 是这份结果服务的词,词不对这份账就不算数 */
interface StoredSearch {
  q: string
  hits: SearchNameHit[]
  truncated: boolean
  stoppedEarly: boolean
}

/** 递给侧栏的清单面板;searching = 当前词还没有回账(防抖中/主进程在走) */
export interface SearchPanel {
  q: string
  hits: SearchNameHit[]
  searching: boolean
  truncated: boolean
  stoppedEarly: boolean
}

export function useWorkspaceSearch(searchRoot: string | null): {
  query: string
  setQuery: (v: string) => void
  /** 非 null = 侧栏树区整体换成结果清单;null = 没词/没工作区,文件树原样 */
  panel: SearchPanel | null
  /** 换工作区/回首页时清账:词、清单、在途搜索一起走 */
  clear: () => void
} {
  const [query, setQuery] = useState('')
  const [stored, setStored] = useState<StoredSearch | null>(null)
  const seq = useRef(0)
  const q = query.trim()

  useEffect(() => {
    if (!searchRoot || q === '') {
      seq.current++
      return
    }
    const ticket = ++seq.current
    const timer = setTimeout(() => {
      window.atlas
        .searchNames(searchRoot, q)
        .then((r) => {
          if (ticket !== seq.current || r.cancelled) return
          setStored({ q, hits: r.hits, truncated: r.truncated, stoppedEarly: r.stoppedEarly })
        })
        .catch(() => {
          if (ticket !== seq.current) return
          // 搜索失败(路径没了/权限收紧)按空账交:清单亮「没找到」,不装死
          setStored({ q, hits: [], truncated: false, stoppedEarly: false })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [q, searchRoot])

  function clear(): void {
    seq.current++
    setQuery('')
    setStored(null)
  }

  const panel: SearchPanel | null =
    searchRoot !== null && q !== ''
      ? {
          q,
          hits: stored?.q === q ? stored.hits : [],
          searching: stored?.q !== q,
          truncated: stored?.q === q ? stored.truncated : false,
          stoppedEarly: stored?.q === q ? stored.stoppedEarly : false
        }
      : null

  return { query, setQuery, panel, clear }
}
