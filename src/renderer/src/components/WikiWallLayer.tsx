// 卡片墙图层(线索桌):图谱画布内由文件夹结构变形而来的语义视图,不开新页签。
// 这里管顶部条(生成、进度下拉、整理桌面、桌面与列表切换)和右侧详情面板;
// 桌面本身(摆卡、线绳、拖动、平移缩放)在 WikiWallBoard,列表视图在 WikiWallList。
import { useEffect, useRef, useState } from 'react'
import type { WikiEvent } from '@shared/wikiTypes'
import { WikiWallDetail } from './WikiWallDetail'
import { WikiWallBoard } from './WikiWallBoard'
import { WikiWallList } from './WikiWallList'
import { setWallPositions, useWallPositions } from '../wikiWallBoardStore'
import type { WallPositions } from '../wikiWallPositions'
import type { WikiWallData } from '../useWikiWall'
import { friendlyErr } from '../errText'

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
  onClose,
  focus
}: {
  rootPath: string
  wall: WikiWallData
  onClose: () => void
  /** 外部要求选中某张卡(侧栏、搜索跳卡):n 递增保证同一张卡重复点也生效 */
  focus?: { pageId: string; n: number } | null
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 外部跳卡:渲染期对齐已应用的序号,新序号到来时直接选中(不用 effect 同步状态)
  const [appliedFocusN, setAppliedFocusN] = useState(0)
  if (focus && focus.n !== appliedFocusN) {
    setAppliedFocusN(focus.n)
    setSelectedId(focus.pageId)
  }
  const [mode, setMode] = useState<'board' | 'list'>('board')
  const positions = useWallPositions(rootPath)
  const [undo, setUndo] = useState<WallPositions | null>(null)
  const arranged = Object.keys(positions).length > 0
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
        <span className="wiki-wall-title">Wiki 线索桌</span>
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
        {undo !== null && !arranged ? (
          <button
            type="button"
            className="wiki-wall-btn"
            onClick={() => {
              setWallPositions(rootPath, undo)
              setUndo(null)
            }}
          >
            撤销整理
          </button>
        ) : (
          <button
            type="button"
            className="wiki-wall-btn"
            disabled={!arranged || mode !== 'board'}
            title="把手动拖过的卡放回自动摆放的位置"
            onClick={() => {
              setUndo(positions)
              setWallPositions(rootPath, {})
            }}
          >
            整理桌面
          </button>
        )}
        <button
          type="button"
          className="wiki-wall-btn"
          aria-pressed={mode === 'list'}
          onClick={() => setMode((value) => (value === 'board' ? 'list' : 'board'))}
        >
          {mode === 'board' ? '列表' : '桌面'}
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
      {mode === 'board' ? (
        <WikiWallBoard
          rootPath={rootPath}
          cards={wall.cards}
          links={wall.links}
          ready={!wall.loading}
          selectedId={selectedId}
          onSelect={(pageId) => {
            setSelectedId(pageId)
            setUndo(null)
          }}
        />
      ) : (
        <WikiWallList cards={wall.cards} selectedId={selectedId} onSelect={setSelectedId} />
      )}
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
