// 文件夹详情正文:内容清单与模块构成两块,可分别由「显示项」关掉。
// 内容清单只列直接子项;模块构成按后端切出的模块统计后代文件。
import type { LevelNode } from '@shared/graphView'
import type { GroupTree } from '@shared/hierarchy'
import type { ModuleMap } from '@shared/types'
import { folderContents } from '../graph/folderContents'
import type { GraphPanelSectionId } from '../graph/graphPanelSections'
import { folderComposition } from '../graph/moduleDetails'
import type { ModuleNames } from '../graph/moduleNames'
import { cardsForFiles, descendantFilesOf } from '../graph/wikiCardOwner'
import type { WikiWallCard } from '@shared/wikiTypes'
import { ModuleChip } from './GraphModuleSection'
import { GraphWikiFolderSection } from './GraphWikiCardSection'

export interface FolderBodyProps {
  node: LevelNode
  modules: ModuleMap | null
  tree: GroupTree
  colorOf: (moduleId: string) => string
  /** 当前语种的模块显示名 */
  moduleNames?: ModuleNames
  /** 卡片墙的卡:Wiki 区按后代文件聚合覆盖 */
  wallCards: readonly WikiWallCard[]
  onShowWallCard: (pageId: string) => void
  hidden: ReadonlySet<GraphPanelSectionId>
  /** 「显示项」拖出来的区块顺序 */
  order: readonly GraphPanelSectionId[]
}

function FolderWikiSection({
  node,
  tree,
  wallCards,
  onShowWallCard
}: FolderBodyProps): React.JSX.Element | null {
  const coverage = cardsForFiles(wallCards, descendantFilesOf(tree, node.id))
  if (coverage.length === 0) return null
  return <GraphWikiFolderSection coverage={coverage} onShowCard={onShowWallCard} />
}

function FolderContentsSection({ node, tree }: FolderBodyProps): React.JSX.Element {
  if (!tree.has(node.id)) {
    return <p className="graph-panel-note">这个文件夹不在当前扫描范围内</p>
  }
  if (tree.isLazy(node.id) && tree.children(node.id).length === 0) {
    return <p className="graph-panel-note">这个文件夹还没读取,进入后才能看到内容</p>
  }
  const { entries, hidden } = folderContents(tree, node.id)
  if (entries.length === 0) return <p className="graph-panel-note">这个文件夹是空的</p>
  return (
    <section className="graph-panel-section">
      <h3 className="graph-panel-h">文件夹内容</h3>
      <ul className="graph-file-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <div className="graph-file">
              <span className="graph-file-name">{entry.name}</span>
              {entry.kind === 'folder' && (
                <span className="graph-file-note">{entry.descendantFiles} 个文件</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="graph-panel-note">其余 {hidden} 项未列出</p>}
    </section>
  )
}

function FolderCompositionSection({
  node,
  modules,
  colorOf,
  moduleNames
}: FolderBodyProps): React.JSX.Element | null {
  if (!modules) return null
  const shares = folderComposition(modules, node.id, moduleNames)
  if (shares.length === 0) return null
  return (
    <section className="graph-panel-section">
      <h3 className="graph-panel-h">模块构成</h3>
      <ul className="graph-file-list">
        {shares.map((s) => (
          <li key={s.moduleId}>
            <div className="graph-file">
              <ModuleChip name={s.name} color={colorOf(s.moduleId)} />
              <span className="graph-file-note">{s.files} 个文件</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function FolderBody(props: FolderBodyProps): React.JSX.Element {
  const { hidden, order } = props
  return (
    <>
      {order.map((id) => {
        if (hidden.has(id)) return null
        if (id === 'wiki') return <FolderWikiSection key={id} {...props} />
        if (id === 'contents') return <FolderContentsSection key={id} {...props} />
        if (id === 'composition') return <FolderCompositionSection key={id} {...props} />
        return null
      })}
    </>
  )
}
