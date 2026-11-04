// 侧栏 Wiki 说明(第二版):文件所属主题卡的现状,动作直达文档、卡片墙与单页生成。
// 没有卡认领但旧版有页时只给一句旧版提示;文件夹按覆盖聚合列卡。
import { useState } from 'react'
import type { WikiWallCard } from '@shared/wikiTypes'
import type { WikiCardCoverage, WikiCardOwner } from '../graph/wikiCardOwner'

const STATUS_TEXT: Record<WikiWallCard['status'], string> = {
  planned: '待生成',
  done: '已生成',
  stale: '已过期',
  failed: '生成失败'
}

const KIND_TEXT: Record<WikiWallCard['kind'], string> = {
  leaf: '主题页',
  overview: '总览',
  root: '根主题'
}

export function GraphWikiCardSection({
  owner,
  onOpenDoc,
  onShowCard,
  onGenerate
}: {
  owner: WikiCardOwner
  onOpenDoc: (file: string) => void
  onShowCard: (pageId: string) => void
  onGenerate: (pageId: string) => Promise<string | null>
}): React.JSX.Element {
  const { card, via } = owner
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const generate = (): void => {
    setStarting(true)
    setError(null)
    void onGenerate(card.pageId).then((problem) => {
      setStarting(false)
      if (problem !== null) setError(problem)
    })
  }
  return (
    <section className="graph-panel-section">
      <h3 className="graph-panel-h">Wiki 说明</h3>
      <div className="graph-file graph-wiki-owner">
        <span className="graph-file-name">{card.title}</span>
        <span className="graph-file-note">
          {KIND_TEXT[card.kind]} · {STATUS_TEXT[card.status]}
        </span>
      </div>
      {via === 'included' && <p className="graph-panel-note">这个文件收录在这张总览里</p>}
      {card.topicPath.length > 0 && (
        <p className="graph-panel-note">{card.topicPath.join(' / ')}</p>
      )}
      {card.excerpt !== '' ? (
        <p className="graph-wiki-excerpt">{card.excerpt}</p>
      ) : (
        card.summary !== '' && <p className="graph-wiki-summary">{card.summary}</p>
      )}
      {card.keyFiles.length > 0 && (
        <div className="graph-wiki-block">
          <p className="graph-folder-name">关键文件</p>
          <ul className="graph-file-list">
            {card.keyFiles.map((file) => (
              <li key={file}>
                <div className="graph-file">
                  <span className="graph-file-name">{file}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="graph-wiki-actions">
        {card.file !== '' && (
          <button type="button" className="graph-panel-btn" onClick={() => onOpenDoc(card.file)}>
            打开说明文档
          </button>
        )}
        <button type="button" className="graph-panel-btn" onClick={() => onShowCard(card.pageId)}>
          在卡片墙里看
        </button>
        {card.status !== 'done' && (
          <button type="button" className="graph-panel-btn" disabled={starting} onClick={generate}>
            {starting ? '正在启动…' : card.status === 'planned' ? '生成这一页' : '重新生成这一页'}
          </button>
        )}
      </div>
      {error !== null && <p className="graph-panel-note">{error}</p>}
    </section>
  )
}

export function GraphWikiLegacyNote({ onShowWall }: { onShowWall: () => void }): React.JSX.Element {
  return (
    <section className="graph-panel-section">
      <h3 className="graph-panel-h">Wiki 说明</h3>
      <p className="graph-panel-note">这个项目的说明是旧版的,重新生成后按新版展示</p>
      <button type="button" className="graph-panel-btn" onClick={onShowWall}>
        去卡片墙
      </button>
    </section>
  )
}

export function GraphWikiFolderSection({
  coverage,
  onShowCard
}: {
  coverage: WikiCardCoverage[]
  onShowCard: (pageId: string) => void
}): React.JSX.Element {
  return (
    <section className="graph-panel-section">
      <h3 className="graph-panel-h">Wiki 说明</h3>
      <ul className="graph-file-list">
        {coverage.slice(0, 6).map(({ card, count }) => (
          <li key={card.pageId}>
            <button
              type="button"
              className="graph-file graph-file-btn"
              onClick={() => onShowCard(card.pageId)}
            >
              <span className="graph-file-name">{card.title}</span>
              <span className="graph-file-note">
                {STATUS_TEXT[card.status]} · 覆盖 {count} 个文件
              </span>
            </button>
          </li>
        ))}
      </ul>
      {coverage.length > 6 && (
        <p className="graph-panel-more">其余 {coverage.length - 6} 张卡在卡片墙里看</p>
      )}
    </section>
  )
}
