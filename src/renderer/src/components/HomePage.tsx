import type { DriveInfo } from '@shared/types'
import { driveCapacity, driveKindName } from '../driveMeta'
import { formatRecentTime, type RecentProject } from '../recents'
import { IconFolder } from './Icons'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

/** 容量条走掉的百分比(0~100);拿不到容量回 null(不画条) */
function driveUsedPercent(d: DriveInfo): number | null {
  if (!d.total) return null
  const used = (d.total - (d.free ?? 0)) / d.total
  return Math.round(Math.min(100, Math.max(0, used * 100)))
}

interface HomePageProps {
  recents: RecentProject[]
  drives: DriveInfo[] | null
  drivesNote: string | null
  onPick: () => void
  onOpen: (path: string) => void
  onRemoveRecent: (path: string) => void
}

export function HomePage({
  recents,
  drives,
  drivesNote,
  onPick,
  onOpen,
  onRemoveRecent
}: HomePageProps): React.JSX.Element {
  return (
    <div className="welcome-page">
      <section className="welcome-intro">
        <div className="welcome-message">
          <h1>先看懂项目,再动手。</h1>
          <p className="welcome-lead">
            CodeAtlas 把项目里的文件整理成一张导览图,帮你找到入口,看懂每个部分负责什么。
          </p>
          <button type="button" className="btn btn-primary welcome-open" onClick={onPick}>
            <IconFolder />
            选择项目文件夹
          </button>
          <p className="welcome-safe">只读取文件,不修改代码。不设置 AI,也能先逛地图。</p>
        </div>
        <ol className="welcome-route" aria-label="第一次使用的三个步骤">
          <li>
            <span>1</span>
            <div>
              <h2>选一个项目</h2>
              <p>选择代码所在的文件夹,不用选整块硬盘。</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h2>先看项目导览</h2>
              <p>从项目说明开始,再看文件夹分别装了什么。</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h2>点一个文件</h2>
              <p>查看说明和内容;需要时再让 AI 讲解。</p>
            </div>
          </li>
        </ol>
      </section>
      <section className="welcome-recent" aria-label="最近打开的项目">
        <h2>继续看项目</h2>
        {recents.length > 0 ? (
          <div className="recents-grid">
            {recents.map((r) => (
              <div key={r.p} className="recent-card">
                <button
                  type="button"
                  className="recent-open"
                  onClick={() => onOpen(r.p)}
                  title={r.p}
                >
                  <strong className="recent-name">{r.n}</strong>
                  <small className="recent-time">{formatRecentTime(r.t)}</small>
                </button>
                <button
                  type="button"
                  className="recent-remove"
                  onClick={() => onRemoveRecent(r.p)}
                  aria-label={`从最近列表删掉 ${r.n}`}
                  title="只删这条记录,不动文件夹本身"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p>打开过的项目会留在这里。第一次使用?点击上方「选择项目文件夹」。</p>
        )}
      </section>
      <details className="welcome-disks">
        <summary>找不到项目文件夹?浏览这台电脑</summary>
        <p>这里会扫描所选磁盘。项目导览更适合一个具体的项目文件夹。</p>
        {drives === null && !drivesNote ? (
          <div className="state">
            <ProgressDots />
            正在列盘符……
          </div>
        ) : drivesNote ? (
          <Notice kind="error">{drivesNote}</Notice>
        ) : (
          <div className="drives-grid">
            {(drives ?? []).map((d) => {
              const used = driveUsedPercent(d)
              return (
                <button
                  key={d.letter}
                  type="button"
                  className="drive-card"
                  onClick={() => onOpen(d.root)}
                >
                  <strong className="drive-letter">{d.letter}:</strong>
                  <span className="drive-info">
                    <strong>{driveKindName(d)}</strong>
                    <small>{driveCapacity(d)}</small>
                    {used !== null && (
                      <i
                        className={`drive-bar${d.free !== undefined && d.free / d.total! < 0.1 ? ' is-low' : ''}`}
                      >
                        <i style={{ width: `${used}%` }} />
                      </i>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </details>
    </div>
  )
}
