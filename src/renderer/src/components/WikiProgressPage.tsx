// 仓库 Wiki 进度页:逐页看生成到哪、点开文档或所在文件夹,失败与过期可原地重试。
// 展示语言只切「看哪一栏」,不改生成设置;换位置、清理这类全局动作留给设置卡片。
import { useEffect, useMemo, useState } from 'react'
import type { DepGraphResult, ScanResult } from '@shared/types'
import type { WikiLanguageSummary } from '@shared/wikiTypes'
import { DEFAULT_WIKI_LANGUAGE } from '@shared/wikiTypes'
import { TRANSLATE_LANGS, translateLang } from '@shared/translateLangs'
import { useWikiProgress, type WikiFinish } from '../useWikiProgress'
import {
  assembleWikiPages,
  countWikiRows,
  eventsForLanguage,
  mergeWikiRows,
  pickWikiPage,
  regeneratePageIds,
  retryPageIds,
  type WikiProgressRow,
  type WikiRowStatus
} from '../wikiProgressModel'
import { Notice } from './Notice'
import { TreeIcon } from './Icons'

const STATUS_TEXT: Record<WikiRowStatus, string> = {
  pending: '未生成',
  queued: '排队中',
  running: '生成中',
  done: '已完成',
  stale: '已过期',
  missing: '文件缺失',
  failed: '失败',
  cancelled: '已取消'
}

function rowStatusText(row: WikiProgressRow): string {
  if (row.status === 'done' && row.cached) return '缓存命中'
  return STATUS_TEXT[row.status]
}

function formatWikiTime(iso: string | null): string {
  if (iso === null || iso === '') return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
}

function finishText(finish: WikiFinish): string {
  if (finish.status === 'cancelled') return `已取消:完成 ${finish.done} 篇`
  const parts: string[] = []
  if (finish.done > 0) parts.push(`完成 ${finish.done} 篇`)
  if (finish.skipped > 0) parts.push(`命中缓存 ${finish.skipped} 篇`)
  if (finish.failed > 0) parts.push(`失败 ${finish.failed} 篇`)
  if (finish.cancelled > 0) parts.push(`取消 ${finish.cancelled} 篇`)
  if (finish.error) parts.push(finish.error)
  return finish.status === 'failed'
    ? `本轮没跑完:${parts.join(' · ')}`
    : `本轮结束:${parts.join(' · ')}`
}

export function WikiProgressPage({
  result,
  graph,
  graphLoading,
  graphNote,
  onLoadGraph
}: {
  result: ScanResult | null
  graph: DepGraphResult | null
  graphLoading: boolean
  graphNote: string | null
  onLoadGraph: () => Promise<void>
}): React.JSX.Element {
  const projectRoot = result?.rootPath ?? null
  const wiki = useWikiProgress(projectRoot)
  const pages = useMemo(() => assembleWikiPages(result, graph), [result, graph])
  const [language, setLanguage] = useState<string | null>(null)

  // 进度页要按图谱的模块清单对账,图谱没算过就先补一轮
  useEffect(() => {
    if (result !== null && graph === null && !graphLoading) void onLoadGraph()
  }, [result, graph, graphLoading, onLoadGraph])

  const settingsLanguage = wiki.settings?.language ?? DEFAULT_WIKI_LANGUAGE
  const viewLanguage = language ?? settingsLanguage
  const languageOptions = useMemo(() => {
    const codes = new Set<string>([settingsLanguage])
    for (const item of wiki.snapshot?.languages ?? []) codes.add(item.code)
    return TRANSLATE_LANGS.filter((item) => codes.has(item.code))
  }, [settingsLanguage, wiki.snapshot])
  const summary: WikiLanguageSummary | null =
    wiki.snapshot?.languages.find((item) => item.code === viewLanguage) ?? null
  const rows = useMemo(
    () => mergeWikiRows(pages, summary, eventsForLanguage(wiki.events, viewLanguage)),
    [pages, summary, wiki.events, viewLanguage]
  )
  const counts = useMemo(() => countWikiRows(rows), [rows])
  const run = wiki.run !== null && wiki.run.language === viewLanguage ? wiki.run : null
  const pageIds = useMemo(() => new Set(pages.map((page) => page.pageId)), [pages])
  const retryable = retryPageIds(rows).filter((id) => pageIds.has(id))
  const regenerate = regeneratePageIds(rows).filter((id) => pageIds.has(id))
  const openable = (row: WikiProgressRow): boolean =>
    row.file !== null && (row.status === 'done' || row.status === 'stale')

  const retryFailed = (): void => {
    void wiki.runPages(pickWikiPage(pages, retryable), viewLanguage, retryable, true)
  }
  const regenerateStale = (): void => {
    void wiki.runPages(pickWikiPage(pages, regenerate), viewLanguage, regenerate, true)
  }

  if (result === null) {
    return (
      <div className="wiki-page">
        <p className="wiki-empty">先打开一个项目,再来看它的 Wiki</p>
      </div>
    )
  }
  if (wiki.loading) {
    return (
      <div className="wiki-page">
        <p className="wiki-empty">正在读 Wiki 记账……</p>
      </div>
    )
  }

  const percent = ((): number => {
    if (run !== null) return run.total === 0 ? 0 : (run.processed / run.total) * 100
    return counts.total === 0 ? 0 : ((counts.done + counts.cached) / counts.total) * 100
  })()

  return (
    <div className="wiki-page">
      <header className="wiki-head">
        <div className="wiki-title">
          <TreeIcon name="bookOpen" size={15} />
          <span>仓库 Wiki</span>
          <small>
            {translateLang(viewLanguage)?.label ?? viewLanguage}
            {summary === null ? ' · 还没有生成记录' : ` · ${summary.pages.length} 篇记账`}
          </small>
        </div>
        <div className="wiki-actions">
          {run !== null && (
            <button type="button" className="btn btn-ghost" onClick={() => void wiki.cancel()}>
              取消生成
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={retryable.length === 0 || run !== null}
            onClick={retryFailed}
          >
            重试失败{retryable.length > 0 ? `(${retryable.length})` : ''}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={regenerate.length === 0 || run !== null}
            onClick={regenerateStale}
          >
            重新生成过期{regenerate.length > 0 ? `(${regenerate.length})` : ''}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void wiki.reload()}>
            刷新
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void wiki.chooseLocation()}
          >
            更改位置
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={wiki.settings?.location == null}
            onClick={() => void wiki.openLocation()}
          >
            打开位置
          </button>
        </div>
      </header>

      <div className="wiki-sub">
        <div className="wiki-langs" role="group" aria-label="查看哪一语的 Wiki">
          {languageOptions.map((item) => (
            <button
              key={item.code}
              type="button"
              className={`chip-link${item.code === viewLanguage ? ' is-on' : ''}`}
              onClick={() => setLanguage(item.code)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="wiki-counts">
          已完成 {counts.done} / {counts.total}
          {counts.failed > 0 ? ` · 失败 ${counts.failed}` : ''}
          {counts.stale > 0 ? ` · 过期 ${counts.stale}` : ''}
          {counts.missing > 0 ? ` · 缺失 ${counts.missing}` : ''}
          {counts.pending > 0 ? ` · 未生成 ${counts.pending}` : ''}
          {run !== null ? ` · 进行中 ${run.processed}/${run.total}` : ''}
        </span>
      </div>

      <div className="wiki-bar" role="progressbar" aria-valuenow={Math.round(percent)}>
        <span className="wiki-bar-fill" style={{ width: `${percent}%` }} />
      </div>

      <div className="wiki-notices">
        {wiki.loadError !== null && (
          <Notice kind="error">{wiki.loadError}(点「刷新」再试一次)</Notice>
        )}
        {wiki.settings?.location == null && (
          <Notice kind="info">还没选 Wiki 存放位置,点「更改位置」挑一个仓库外的文件夹。</Notice>
        )}
        {wiki.snapshot?.damaged === true && (
          <Notice kind="warn">
            这个项目的 Wiki 记账损坏,只能按新增内容重新生成;清理前请先确认没有想留的文档。
          </Notice>
        )}
        {graphNote !== null && <Notice kind="warn">{graphNote}</Notice>}
        {wiki.actionError !== null && (
          <Notice kind="error">
            {wiki.actionError}
            <button
              type="button"
              className="wiki-notice-close"
              aria-label="关闭提示"
              onClick={wiki.dismissActionError}
            >
              ×
            </button>
          </Notice>
        )}
        {wiki.finish !== null && <Notice kind="info">{finishText(wiki.finish)}</Notice>}
      </div>

      {graphLoading && pages.length === 0 ? (
        <p className="wiki-empty">正在分析项目结构,马上就能列出要写哪些页……</p>
      ) : rows.length === 0 ? (
        <p className="wiki-empty">
          {graph === null
            ? '还没有关系分析结果,先到「关系图谱」里跑一次分析'
            : '这个项目里还没有可生成的内容'}
        </p>
      ) : (
        <ul className="wiki-rows">
          {rows.map((row) => (
            <li key={row.pageId} className={`wiki-row is-${row.status}`}>
              <span className={`wiki-kind is-${row.kind}`}>
                {row.kind === 'module' ? '模块' : '散件组'}
              </span>
              <span className="wiki-row-main">
                <span className="wiki-row-name" title={row.name}>
                  {row.name}
                  {row.truncated && <span className="wiki-row-flag">已裁剪</span>}
                </span>
                {row.error !== null ? (
                  <span className="wiki-row-error">{row.error}</span>
                ) : row.file !== null ? (
                  <button
                    type="button"
                    className="wiki-row-file"
                    title={openable(row) ? '打开这篇文档' : '这篇还没有落盘'}
                    disabled={!openable(row)}
                    onClick={() => void wiki.openDoc(viewLanguage, row.file ?? '')}
                  >
                    {row.file}
                  </button>
                ) : (
                  <span className="wiki-row-file is-muted">还没有生成</span>
                )}
              </span>
              <span className="wiki-row-status">{rowStatusText(row)}</span>
              <span className="wiki-row-time">{formatWikiTime(row.generatedAt)}</span>
              <span className="wiki-row-actions">
                {openable(row) && row.file !== null && (
                  <button
                    type="button"
                    className="wiki-reveal"
                    aria-label="打开所在文件夹"
                    title="打开所在文件夹"
                    onClick={() => void wiki.revealDoc(viewLanguage, row.file ?? '')}
                  >
                    <TreeIcon name="folder" size={13} mono={false} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <footer className="wiki-foot">
        <span title={wiki.settings?.location ?? ''}>
          存放位置:{wiki.settings?.location ?? '还没选'}
        </span>
        {run !== null && run.model !== '' && <span>模型:{run.model}</span>}
      </footer>
    </div>
  )
}
