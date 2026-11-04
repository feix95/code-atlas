// 卡片墙右侧详情面板:选中卡片的说明、关键文件与动作(打开、定位、单页生成)。
import type { WikiWallCard } from '@shared/wikiTypes'

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

export function WikiWallDetail({
  card,
  rootPath,
  language,
  running,
  starting,
  onClose,
  onGenerate
}: {
  card: WikiWallCard
  rootPath: string
  language: string
  running: boolean
  starting: boolean
  onClose: () => void
  onGenerate: (pageId: string, force: boolean) => void
}): React.JSX.Element {
  return (
    <aside className="wiki-wall-detail">
      <button type="button" className="wiki-wall-detail-close" onClick={onClose}>
        ×
      </button>
      <p className="wiki-wall-detail-kind">
        {KIND_LABEL[card.kind]} · {STATUS_LABEL[card.status]}
      </p>
      <h3>{card.title}</h3>
      {card.topicPath.length > 0 && (
        <p className="wiki-wall-detail-topic">{card.topicPath.join(' / ')}</p>
      )}
      {/* 摘要是导读的截短版,两段都有时只放完整的导读,免得同一段话出现两遍 */}
      {card.excerpt !== '' ? (
        <p className="wiki-wall-detail-excerpt">{card.excerpt}</p>
      ) : (
        card.summary !== '' && <p className="wiki-wall-detail-excerpt">{card.summary}</p>
      )}
      {card.keyFiles.length > 0 && (
        <>
          <p className="wiki-wall-detail-label">关键文件</p>
          <ul>
            {card.keyFiles.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </>
      )}
      <div className="wiki-wall-detail-actions">
        {card.file !== '' && (
          <>
            <button
              type="button"
              className="wiki-wall-btn is-primary"
              onClick={() => void window.atlas.wiki.openDoc(rootPath, language, card.file)}
            >
              打开文档
            </button>
            <button
              type="button"
              className="wiki-wall-btn"
              onClick={() => void window.atlas.wiki.revealDoc(rootPath, language, card.file)}
            >
              在文件夹中定位
            </button>
          </>
        )}
        {card.kind === 'leaf' && !running && (
          <button
            type="button"
            className="wiki-wall-btn"
            disabled={starting}
            onClick={() => onGenerate(card.pageId, card.status !== 'planned')}
          >
            {card.status === 'planned' ? '生成这一页' : '重新生成这一页'}
          </button>
        )}
      </div>
      {card.kind === 'leaf' && (
        <p className="wiki-wall-detail-note">只生成这一页;生成全部时,内容没变过的页会自动跳过</p>
      )}
    </aside>
  )
}
