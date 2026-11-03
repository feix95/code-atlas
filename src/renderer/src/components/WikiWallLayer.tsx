// 卡片墙图层:图谱画布内由文件夹结构变形而来的语义视图,不开新页签。
// 顶部条管生成与进度(下拉展开),板面按主题分区摆卡,点卡在右侧出详情面板。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WikiEvent, WikiWallCard } from '@shared/wikiTypes'
import { layoutWikiWall } from '../wikiWallLayout'
import { WikiWallDetail } from './WikiWallDetail'
import type { WikiWallData } from '../useWikiWall'
import { friendlyErr } from '../errText'

const KIND_LABEL: Record<WikiWallCard['kind'], string> = {
  root: '根主题',
  overview: '总览',
  leaf: '主题页'
}

const STATUS_LABEL: Record<WikiWallCard['status'], string> = {
  planned: '待生成',
  done: '已生成',
  stale: '已过期',
  failed: '生成失败'
}

interface RunLine {
  pageId: string
  name: string
  status: string
}

const RUN_STATUS_LABEL: Record<string, string> = {
  running: '生成中',
  done: '已生成',
  skipped: '未变化,已跳过',
  failed: '失败',
  cancelled: '已取消'
}

export function WikiWallLayer({
  rootPath,
  wall,
  onClose
}: {
  rootPath: string
  wall: WikiWallData
  onClose: () => void
}): React.JSX.Element {
  const layout = useMemo(() => layoutWikiWall(wall.cards, wall.links), [wall.cards, wall.links])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = wall.cards.find((card) => card.pageId === selectedId) ?? null
  const [running, setRunning] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [processed, setProcessed] = useState(0)
  const [total, setTotal] = useState(0)
  const [lines, setLines] = useState<RunLine[]>([])
  const [finishText, setFinishText] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const runningRef = useRef(false)

  // 挂载时补读一次运行快照:任务可能在本层打开前就已开跑
  useEffect(() => {
    void window.atlas.wiki.runStatusV2().then((status) => {
      if (status.active && status.projectRoot === rootPath) {
        runningRef.current = true
        setRunning(true)
        setProcessed(status.processed)
        setTotal(status.total)
      }
    })
  }, [rootPath])

  useEffect(() => {
    const off = window.atlas.wiki.onEvent((event: WikiEvent) => {
      if (event.projectRoot !== rootPath) return
      if (event.source !== 'v2') return
      if (event.type === 'progress') {
        if (!runningRef.current) {
          runningRef.current = true
          setRunning(true)
        }
        setProcessed(event.processed)
        setTotal(event.total)
        setLines((prev) =>
          [
            { pageId: event.page.pageId, name: event.page.name, status: event.page.status },
            ...prev.filter((line) => line.pageId !== event.page.pageId)
          ].slice(0, 30)
        )
      } else {
        runningRef.current = false
        setRunning(false)
        setFinishText(
          event.status === 'done'
            ? `这一轮完成了:新生成 ${event.done} 页,跳过 ${event.skipped} 页,失败 ${event.failed} 页`
            : event.status === 'cancelled'
              ? '这一轮已取消'
              : `这一轮没能完成${event.error ? `:${event.error}` : ''}`
        )
        wall.refresh()
      }
    })
    return off
    // wall.refresh 每次渲染换引用,只按 rootPath 订阅一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath])

  const start = async (onlyPageId?: string, force = false): Promise<void> => {
    setRunError(null)
    setFinishText(null)
    setLines([])
    setStarting(true)
    const outcome = await window.atlas.wiki
      .startV2({
        requestId: crypto.randomUUID(),
        projectRoot: rootPath,
        language: wall.language,
        ...(force ? { force: true } : {}),
        ...(onlyPageId ? { pageIds: [onlyPageId] } : {})
      })
      .catch((err: unknown) => ({ ok: false as const, error: friendlyErr(err) }))
    setStarting(false)
    if (!outcome.ok) {
      setRunError(outcome.error)
      setProgressOpen(true)
      return
    }
    runningRef.current = true
    setRunning(true)
    setTotal(outcome.total)
    setProcessed(0)
    setProgressOpen(true)
  }

  const doneCount = wall.cards.filter(
    (card) => card.status === 'done' || card.status === 'stale'
  ).length
  const leafTotal = wall.cards.filter((card) => card.kind === 'leaf').length

  return (
    <div className="wiki-wall" role="region" aria-label="Wiki 卡片墙">
      <div className="wiki-wall-bar">
        <span className="wiki-wall-title">Wiki 卡片墙</span>
        <span className="wiki-wall-count">
          {wall.loading
            ? '正在摆卡…'
            : `共 ${wall.cards.length} 张卡 · 叶子页已生成 ${doneCount}/${leafTotal}`}
        </span>
        {running ? (
          <button
            type="button"
            className="wiki-wall-btn"
            onClick={() => void window.atlas.wiki.cancelV2()}
          >
            取消生成
          </button>
        ) : (
          <button
            type="button"
            className="wiki-wall-btn is-primary"
            disabled={wall.language === '' || starting}
            onClick={() => void start()}
          >
            {starting ? '正在启动…' : '生成全部'}
          </button>
        )}
        <button
          type="button"
          className="wiki-wall-btn"
          aria-expanded={progressOpen}
          onClick={() => setProgressOpen((value) => !value)}
        >
          进度{running ? ` ${processed}/${total}` : ''}
        </button>
        <button type="button" className="wiki-wall-btn" onClick={onClose}>
          变回结构图
        </button>
      </div>
      {progressOpen && (
        <div className="wiki-wall-progress">
          {running && (
            <p>
              正在生成:{processed}/{total} 页
            </p>
          )}
          {finishText && <p>{finishText}</p>}
          {runError && <p className="wiki-wall-error">{runError}</p>}
          {!running && !finishText && !runError && <p>这一轮还没有动静</p>}
          <ul>
            {lines.map((line) => (
              <li key={line.pageId}>
                <span>{line.name}</span>
                <span className="wiki-wall-line-status">
                  {RUN_STATUS_LABEL[line.status] ?? line.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {wall.error && <p className="wiki-wall-error">{wall.error}</p>}
      {wall.damaged && (
        <p className="wiki-wall-error">这个项目的 Wiki 记账已损坏,先在设置里清理后重新生成</p>
      )}
      <div className="wiki-wall-scroll">
        <div className="wiki-wall-board" style={{ width: layout.width, height: layout.height }}>
          {layout.regions.map((region) => (
            <div
              key={region.title || 'root-band'}
              className="wiki-wall-region"
              style={{ left: region.x, top: region.y, width: region.w, height: region.h }}
            >
              <span className="wiki-wall-region-title">{region.title}</span>
            </div>
          ))}
          <svg className="wiki-wall-lines" width={layout.width} height={layout.height}>
            {layout.links.map((placed, index) => (
              <line
                key={index}
                x1={placed.x1}
                y1={placed.y1}
                x2={placed.x2}
                y2={placed.y2}
                className={`wiki-wall-line is-${placed.link.kind} is-${placed.tier}`}
              />
            ))}
          </svg>
          {layout.cards.map((placed) => {
            const card = placed.card
            return (
              <button
                key={card.pageId}
                type="button"
                className={`wiki-wall-card is-${card.kind} is-${card.status}${
                  selectedId === card.pageId ? ' is-selected' : ''
                }`}
                style={{ left: placed.x, top: placed.y, width: placed.w, height: placed.h }}
                onClick={() => setSelectedId(card.pageId)}
              >
                <span className="wiki-wall-card-head">
                  <span className="wiki-wall-card-kind">{KIND_LABEL[card.kind]}</span>
                  <span className={`wiki-wall-chip is-${card.status}`}>
                    {STATUS_LABEL[card.status]}
                  </span>
                </span>
                <span className="wiki-wall-card-title">{card.title}</span>
                <span className="wiki-wall-card-body">
                  {card.summary !== ''
                    ? card.summary
                    : card.keyFiles.length > 0
                      ? card.keyFiles.slice(0, 3).join(' · ')
                      : '还没有内容'}
                </span>
                <span className="wiki-wall-card-foot">{card.memberCount} 个文件</span>
              </button>
            )
          })}
        </div>
      </div>
      {selected && (
        <WikiWallDetail
          card={selected}
          rootPath={rootPath}
          language={wall.language}
          running={running}
          starting={starting}
          onClose={() => setSelectedId(null)}
          onGenerate={(pageId, force) => void start(pageId, force)}
        />
      )}
    </div>
  )
}
