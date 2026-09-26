// 关系图谱的层级导航(drill-down):当前目录、进入未扫描(lazy)目录前先按需扫描、返回上一层。
// 导航状态收敛为单一变量:idle | scanning | failed。
import { useCallback, useState } from 'react'
import type { ScanDirNode } from '@shared/types'
import { findDir } from '../scanTreeTools'

export type NavStatus =
  { kind: 'idle' } | { kind: 'scanning'; dirRel: string } | { kind: 'failed'; dirRel: string }

interface NavDeps {
  tree: ScanDirNode | null
  /** 复用 App 的 handleExpandLazy:扫描结果写回共享 ScanResult,失败返回 null */
  expandLazy: (relPath: string) => Promise<ScanDirNode | null>
  /** 真正切换层级前的回调(用于启动淡出过渡) */
  onBeforeChange: () => void
}

export interface GraphNav {
  dirRel: string
  status: NavStatus
  navigate: (relPath: string) => Promise<void>
  goUp: () => void
}

export function parentOf(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i < 0 ? '' : relPath.slice(0, i)
}

export function useGraphNav({ tree, expandLazy, onBeforeChange }: NavDeps): GraphNav {
  const [dirRel, setDirRel] = useState('')
  const [status, setStatus] = useState<NavStatus>({ kind: 'idle' })

  const navigate = useCallback(
    async (relPath: string): Promise<void> => {
      if (!tree || relPath === dirRel) return
      const target = findDir(tree, relPath)
      if (!target) return
      if (target.lazy) {
        setStatus({ kind: 'scanning', dirRel: relPath })
        const sub = await expandLazy(relPath)
        if (!sub) {
          setStatus({ kind: 'failed', dirRel: relPath })
          return
        }
      }
      setStatus({ kind: 'idle' })
      onBeforeChange()
      setDirRel(relPath)
    },
    [tree, dirRel, expandLazy, onBeforeChange]
  )

  const goUp = useCallback(() => {
    if (dirRel !== '') void navigate(parentOf(dirRel))
  }, [dirRel, navigate])

  // 当前目录从扫描树里消失(重新扫描后被删 / 改名):按根目录呈现
  const missing = tree !== null && dirRel !== '' && findDir(tree, dirRel) === null
  return { dirRel: missing ? '' : dirRel, status, navigate, goUp }
}
