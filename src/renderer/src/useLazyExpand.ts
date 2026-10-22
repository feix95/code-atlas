// 分级扫描:点开还没探的目录,只探这一层,子树和统计接进现有地图。
import { useRef, useState } from 'react'
import type { ScanDirNode, ScanResult } from '@shared/types'
import { cleanErrMsg } from './errText'
import type { createRequestScope } from './requestScope'
import { mergeStats, spliceSubtree } from './scanTreeTools'

/**
 * 探目录的状态与动作:树里点箭头、深搜结果沿父链逐层探开,都走这里。
 * 返回探到的子树 —— 深搜结果点开文件时,父链逐层探开要靠这个返回值走下一步。
 */
export function useLazyExpand(deps: {
  result: ScanResult | null
  setResult: React.Dispatch<React.SetStateAction<ScanResult | null>>
  requests: React.RefObject<ReturnType<typeof createRequestScope>>
}): {
  expanding: string | null
  treeNote: string | null
  expandLazy: (relPath: string) => Promise<ScanDirNode | null>
  /** 换工作区/回家时清账:探到一半的守卫要松手,提示要收 */
  resetExpansion: () => void
} {
  const { result, setResult, requests } = deps
  // 分级扫描:正被点开探测的目录 relPath + 探测失败的人话提示
  const [expanding, setExpanding] = useState<string | null>(null)
  const expandingRef = useRef(false)
  const [treeNote, setTreeNote] = useState<string | null>(null)

  async function expandLazy(relPath: string): Promise<ScanDirNode | null> {
    if (!result || expandingRef.current) return null
    expandingRef.current = true
    const isCurrent = requests.current.begin('expand')
    const root = result.rootPath
    setExpanding(relPath)
    setTreeNote(null)
    try {
      // 路径契约:renderer 只回传 (rootPath, relPath),绝对路径只能由主进程 joinRoot 解析
      const sub = await window.atlas.scanSubdir(root, relPath)
      if (!isCurrent()) return null
      setResult((prev) =>
        prev && prev.rootPath === root
          ? {
              ...prev,
              tree: spliceSubtree(prev.tree, relPath, sub.tree),
              stats: mergeStats(prev.stats, sub.stats)
            }
          : prev
      )
      return sub.tree
    } catch (err) {
      if (isCurrent()) setTreeNote(cleanErrMsg(err))
      return null
    } finally {
      if (isCurrent()) {
        setExpanding(null)
        expandingRef.current = false
      }
    }
  }

  function resetExpansion(): void {
    expandingRef.current = false
    setExpanding(null)
    setTreeNote(null)
  }

  return { expanding, treeNote, expandLazy, resetExpansion }
}
