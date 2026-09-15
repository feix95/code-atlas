// 模型货架(2026-09-16):从抱抱脸拉实时 GGUF 榜,零判断纯事实 ——
// 大小/时间/模态/下载量原样摆,筛选器交给用户自己挑;唯一掺的判断是
// 「你这机器带不动」的灰戳,那是保护小白别白下几十 GB 的兜底。
// 点模型行展开文件清单;「下载并使用」按钮归一键到位那一锤管。
import { useCallback, useEffect, useState } from 'react'
import { ProgressDots } from './ProgressDots.tsx'
import {
  formatGgufSize,
  type ModelDownloadProgress,
  type RepoFile,
  type ShelfEntry,
  type ShelfQuery
} from '../../../shared/modelShelf.ts'
import {
  applyShelfQuery,
  formatDownloads,
  formatRelativeDays,
  judgeRun,
  runVerdictLabel
} from '../../../shared/modelShelf.ts'

interface ShelfState {
  entries: ShelfEntry[]
  ramBytes: number
  /** 数据来自哪个源;镜像 = 直连没通,给一句小灰字让用户知道走了哪条路 */
  fromMirror: boolean
}

/** 下载中的那单(进度条用);donePath = 刚下完的(显示「已就位」) */
interface DownloadState {
  repoId: string
  filePath: string
  receivedBytes: number
  totalBytes: number | null
  donePath: string | null
}

export function ModelShelfPanel({ onModelReady }: { onModelReady?: (finalPath: string) => void }): React.JSX.Element {
  const [shelf, setShelf] = useState<ShelfState | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 挂载就要拉货,初始 loading 即 true,不在 effect 里同步 set(会级联渲染) */
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, RepoFile[]>>({})
  const [filesLoading, setFilesLoading] = useState(false)
  const [maxGb, setMaxGb] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<ShelfQuery['sortBy']>('downloads')
  const [desc, setDesc] = useState(true)
  const [download, setDownload] = useState<DownloadState | null>(null)

  // 下载进度:主进程边下边喊,这儿只管画;finalPath 到了 = 完成,报给设置页自动填路径
  useEffect(() => {
    const off = window.atlas.onModelDownloadProgress((p: ModelDownloadProgress) => {
      if (p.finalPath) {
        setDownload((prev) => (prev ? { ...prev, donePath: p.finalPath } : prev))
        onModelReady?.(p.finalPath)
      } else if (!p.error && !p.cancelled) {
        setDownload((prev) =>
          prev ? { ...prev, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes } : prev
        )
      }
    })
    return off
  }, [onModelReady])

  const startDownload = useCallback((repoId: string, filePath: string) => {
    setDownload({ repoId, filePath, receivedBytes: 0, totalBytes: null, donePath: null })
    window.atlas.modelDownloadStart(repoId, filePath).catch(() => {
      // 失败/取消:进度事件里已带人话,这里把行上状态松开
      setDownload(null)
    })
  }, [])

  const cancelDownload = useCallback(() => {
    void window.atlas.modelDownloadCancel()
  }, [])

  useEffect(() => {
    let alive = true
    window.atlas
      .modelShelf()
      .then((r) => {
        if (!alive) return
        setShelf({ entries: r.entries, ramBytes: r.spec.ramBytes, fromMirror: r.source === 'mirror' })
      })
      .catch(() => {
        if (alive) setError('货架没拉下来:网络不通,或者两个数据源都在打盹。检查一下网络再重试。')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
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

  const visible = shelf ? applyShelfQuery(shelf.entries, { maxBytes: maxGb === null ? null : maxGb * 1024 ** 3, sortBy, desc }) : []

  return (
    <div className="shelf">
      <div className="shelf-toolbar">
        <div className="shelf-filter-group" role="group" aria-label="大小筛选">
          <span className="shelf-filter-label">大小</span>
          {([null, 4, 8, 16, 32] as const).map((gb) => (
            <button
              key={String(gb)}
              type="button"
              className={`shelf-chip${maxGb === gb ? ' is-on' : ''}`}
              onClick={() => setMaxGb(gb)}
            >
              {gb === null ? '不限' : `≤ ${gb} GB`}
            </button>
          ))}
        </div>
        <div className="shelf-filter-group" role="group" aria-label="排序">
          <span className="shelf-filter-label">排序</span>
          <button
            type="button"
            className={`shelf-chip${sortBy === 'downloads' && desc ? ' is-on' : ''}`}
            onClick={() => {
              setSortBy('downloads')
              setDesc(true)
            }}
          >
            最热门
          </button>
          <button
            type="button"
            className={`shelf-chip${sortBy === 'downloads' && !desc ? ' is-on' : ''}`}
            onClick={() => {
              setSortBy('downloads')
              setDesc(false)
            }}
          >
            最冷门
          </button>
          <button
            type="button"
            className={`shelf-chip${sortBy === 'lastModified' && desc ? ' is-on' : ''}`}
            onClick={() => {
              setSortBy('lastModified')
              setDesc(true)
            }}
          >
            最新
          </button>
          <button
            type="button"
            className={`shelf-chip${sortBy === 'lastModified' && !desc ? ' is-on' : ''}`}
            onClick={() => {
              setSortBy('lastModified')
              setDesc(false)
            }}
          >
            最旧
          </button>
        </div>
      </div>

      {loading && (
        <p className="shelf-note">
          <ProgressDots /> 正在拉实时榜单,几秒钟的事……
        </p>
      )}
      {error && <p className="shelf-note is-error">{error}</p>}
      {shelf && shelf.fromMirror && <p className="shelf-note is-soft">直连抱抱脸没通,这单走的是国内镜像,数据一样。</p>}

      {shelf && visible.length === 0 && !loading && <p className="shelf-note is-soft">这个大小上限下没有模型,放宽一点试试。</p>}

      <ul className="shelf-list">
        {visible.map((entry) => {
          const verdict = judgeRun(entry.ggufTotalBytes, { ramBytes: shelf?.ramBytes ?? 0, vramBytes: null })
          const isOpen = expanded === entry.id
          return (
            <li key={entry.id} className={`shelf-item${verdict === 'no' ? ' is-unrunnable' : ''}`}>
              <button type="button" className="shelf-row" onClick={() => toggleRepo(entry.id)} aria-expanded={isOpen}>
                <span className="shelf-name" title={entry.id}>
                  {entry.id}
                </span>
                <span className="shelf-tag">{entry.modalityLabel}</span>
                <span className="shelf-meta">{formatGgufSize(entry.ggufTotalBytes)}</span>
                <span className="shelf-meta">{formatDownloads(entry.downloads)} 次下载</span>
                <span className="shelf-meta">{formatRelativeDays(entry.lastModified)}</span>
                {verdict !== 'yes' && <span className={`shelf-verdict is-${verdict}`}>{runVerdictLabel(verdict)}</span>}
                <i className={`shelf-chevron${isOpen ? ' is-open' : ''}`} aria-hidden="true" />
              </button>
              {isOpen && (
                <div className="shelf-files">
                  {filesLoading && <p className="shelf-note is-soft">正在看这个仓库里有什么文件……</p>}
                  {!filesLoading && (files[entry.id]?.length ?? 0) === 0 && (
                    <p className="shelf-note is-soft">这个仓库里没认出 gguf 文件(可能是分卷压缩或空仓库)。</p>
                  )}
                  {(files[entry.id] ?? []).map((f) => {
                    const active =
                      download && download.repoId === entry.id && download.filePath === f.path ? download : null
                    const donePath = active?.donePath ?? null
                    const pct =
                      active !== null && donePath === null && active.totalBytes !== null && active.totalBytes > 0
                        ? Math.min(100, Math.round((active.receivedBytes / active.totalBytes) * 100))
                        : null
                    return (
                      <div key={f.path} className="shelf-file-row">
                        <span className="shelf-file-path" title={f.path}>
                          {f.path}
                        </span>
                        <span className="shelf-meta">{formatGgufSize(f.sizeBytes)}</span>
                        {donePath !== null ? (
                          <span className="shelf-dl-done">✓ 已就位,去上面看看模型路径</span>
                        ) : active !== null ? (
                          <>
                            <span className="shelf-dl-pct">
                              {pct !== null ? `${pct}%` : formatGgufSize(active.receivedBytes)}
                            </span>
                            <span className="shelf-dl-bar" aria-hidden="true">
                              <i style={{ width: `${pct ?? 5}%` }} />
                            </span>
                            <button type="button" className="shelf-dl-btn" onClick={cancelDownload}>
                              取消
                            </button>
                          </>
                        ) : (
                          <button type="button" className="shelf-dl-btn" onClick={() => startDownload(entry.id, f.path)}>
                            下载并使用
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
