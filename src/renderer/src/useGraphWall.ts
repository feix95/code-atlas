// 图谱里的卡片墙开关:数据读一次,已生成过 Wiki 时默认变形,手动切换后以手动为准。
import { useState } from 'react'
import { useWikiWall, type WikiWallData } from './useWikiWall'

export interface GraphWall {
  wall: WikiWallData
  visible: boolean
  toggle: () => void
  close: () => void
  open: () => void
}

export function useGraphWall(rootPath: string): GraphWall {
  const wall = useWikiWall(rootPath)
  const [override, setOverride] = useState<boolean | null>(null)
  const hasGenerated = wall.cards.some((card) => card.status === 'done' || card.status === 'stale')
  const visible = override ?? hasGenerated
  return {
    wall,
    visible,
    toggle: () => setOverride(!visible),
    close: () => setOverride(false),
    open: () => setOverride(true)
  }
}
