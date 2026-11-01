// 搜索结果定位:当前层级里能看到目标文件就直接选中,否则切到文件所在文件夹,
// 等新层级到位后再选中。只改视图状态,不打开文件也不发请求。
import { useCallback, useEffect, useRef } from 'react'
import type { LevelNode } from '@shared/graphView'
import type { VisibleGraph } from '@shared/visibleGraph'
import type { GraphNav } from './useGraphNav'
import { parentOf } from './useGraphNav'
import { pickLocateFile, type WikiSearchHit } from './wikiSearch'

interface LocateDeps {
  level: VisibleGraph | null
  nav: GraphNav
  select: (node: LevelNode) => void
}

export function useGraphLocate({ level, nav, select }: LocateDeps): (hit: WikiSearchHit) => void {
  const pending = useRef<string | null>(null)

  useEffect(() => {
    const file = pending.current
    if (file === null || level === null) return
    const target = level.nodes.find((node) => node.id === file)
    if (target === undefined) return
    pending.current = null
    select(target)
  }, [level, select])

  return useCallback(
    (hit: WikiSearchHit) => {
      const file = pickLocateFile(hit.files)
      if (file === null) return
      const target = level?.nodes.find((node) => node.id === file)
      if (target !== undefined) {
        select(target)
        return
      }
      pending.current = file
      void nav.navigate(parentOf(file))
    },
    [level, nav, select]
  )
}
