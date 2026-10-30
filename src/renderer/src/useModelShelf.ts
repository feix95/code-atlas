// 货架的数据侧:榜单拉取、展开仓库的清单、下载进度订阅 —— 面板只管画。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelDownloadProgress, RepoFile, ShelfEntry } from '../../shared/modelShelf.ts'

export interface ShelfState {
  entries: ShelfEntry[]
  ramBytes: number
}

/** 下载中的那单(进度条用);donePath = 刚下完的;error = 失败或中断的人话 */
export interface DownloadState {
  repoId: string
  filePath: string
  receivedBytes: number
  totalBytes: number | null
  donePath: string | null
  error: string | null
}

export function useModelShelf(onModelReady?: (finalPath: string) => void): {
  shelf: ShelfState | null
  error: string | null
  loading: boolean
  retryShelf: () => void
  expanded: string | null
  toggleRepo: (repoId: string) => void
  files: Record<string, RepoFile[]>
  filesLoading: boolean
  download: DownloadState | null
  startDownload: (repoId: string, filePath: string) => void
  cancelDownload: () => void
} {
  const [shelf, setShelf] = useState<ShelfState | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 挂载就要拉货,初始 loading 即 true,不在 effect 里同步 set(会级联渲染) */
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, RepoFile[]>>({})
  const [filesLoading, setFilesLoading] = useState(false)
  const [download, setDownload] = useState<DownloadState | null>(null)
  // 拉货序号:点「重试」作废在飞的旧请求,慢回来的旧响应不许覆盖新状态
  const shelfSeqRef = useRef(0)
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  /** 发榜单请求(挂载第一拉和断网重试共用):序号作废旧请求,慢回来的旧响应不许覆盖新状态 */
  const fetchShelf = useCallback(() => {
    const seq = ++shelfSeqRef.current
    window.atlas
      .modelShelf()
      .then((r) => {
        if (mountedRef.current && seq === shelfSeqRef.current) {
          setShelf({ entries: r.entries, ramBytes: r.spec.ramBytes })
        }
      })
      .catch(() => {
        if (mountedRef.current && seq === shelfSeqRef.current) {
          setError('无法加载榜单，检查网络后重试')
        }
      })
      .finally(() => {
        if (mountedRef.current && seq === shelfSeqRef.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    fetchShelf()
  }, [fetchShelf])

  /** 「重试」:先把状态拨回「进行中」再发请求(挂载那轮不用,初始就是 loading) */
  const retryShelf = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchShelf()
  }, [fetchShelf])

  // 下载进度:主进程边下边喊,这儿只管画;finalPath 到了 = 完成,报给设置页自动填路径
  useEffect(() => {
    const off = window.atlas.onModelDownloadProgress((p: ModelDownloadProgress) => {
      const isCurrent = (prev: DownloadState | null): prev is DownloadState =>
        prev !== null && prev.repoId === p.repoId && prev.filePath === p.filePath
      if (p.finalPath) {
        setDownload((prev) => (isCurrent(prev) ? { ...prev, donePath: p.finalPath } : prev))
        onModelReady?.(p.finalPath)
        return
      }
      if (p.cancelled) {
        setDownload((prev) => (isCurrent(prev) ? { ...prev, error: '下载中断，请重试' } : prev))
        return
      }
      if (p.error) {
        setDownload((prev) => (isCurrent(prev) ? { ...prev, error: p.error } : prev))
        return
      }
      setDownload((prev) =>
        isCurrent(prev)
          ? { ...prev, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes }
          : prev
      )
    })
    return off
  }, [onModelReady])

  const startDownload = useCallback((repoId: string, filePath: string) => {
    setDownload({
      repoId,
      filePath,
      receivedBytes: 0,
      totalBytes: null,
      donePath: null,
      error: null
    })
    window.atlas.modelDownloadStart(repoId, filePath).catch(() => {
      // 进度事件没来得及报终态就拒绝(例如同名下载占用):兜底给失败提示,行上留重试
      setDownload((prev) =>
        prev !== null && prev.donePath === null && prev.error === null
          ? { ...prev, error: '下载失败，检查网络后重试' }
          : prev
      )
    })
  }, [])

  const cancelDownload = useCallback(() => {
    void window.atlas.modelDownloadCancel()
  }, [])

  const toggleRepo = useCallback(
    (repoId: string) => {
      if (expanded === repoId) {
        setExpanded(null)
        return
      }
      setExpanded(repoId)
      if (!files[repoId]) {
        setFilesLoading(true)
        window.atlas
          .modelFiles(repoId)
          .then((list) => setFiles((prev) => ({ ...prev, [repoId]: list })))
          .catch(() => setFiles((prev) => ({ ...prev, [repoId]: [] })))
          .finally(() => setFilesLoading(false))
      }
    },
    [expanded, files]
  )

  return {
    shelf,
    error,
    loading,
    retryShelf,
    expanded,
    toggleRepo,
    files,
    filesLoading,
    download,
    startDownload,
    cancelDownload
  }
}
