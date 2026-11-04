// 文件详情正文:按「显示项」的顺序拼区块。Wiki 说明与模块相关区块各取各的数据源,
// 数据不够的区块不渲染(可用性已在菜单那层算过)。
import { Fragment } from 'react'
import type { LevelNode } from '@shared/graphView'
import type { DepGraphNode, ModuleMap } from '@shared/types'
import { moduleDetails, type ModuleDetails } from '../graph/moduleDetails'
import type { ModuleNames } from '../graph/moduleNames'
import type { GraphPanelSectionId } from '../graph/graphPanelSections'
import { wikiOwnerOf } from '../graph/wikiOwner'
import { cardOwnerOf } from '../graph/wikiCardOwner'
import type { WikiPanelData } from '../useWikiPanel'
import type { WikiWallCard } from '@shared/wikiTypes'
import { GraphWikiSection } from './GraphWikiSection'
import { GraphWikiCardSection, GraphWikiLegacyNote } from './GraphWikiCardSection'
import {
  ModuleChip,
  ModuleFilesSection,
  ModuleLinksSection,
  ModuleStylesSection,
  ModuleTestsSection
} from './GraphModuleSection'

export interface GraphFileBodyProps {
  node: LevelNode
  modules: ModuleMap | null
  depNodes: ReadonlyMap<string, DepGraphNode>
  dirRel: string
  colorOf: (moduleId: string) => string
  moduleNames: ModuleNames
  wiki: WikiPanelData | null
  /** 卡片墙的卡:Wiki 区优先按卡展示 */
  wallCards: readonly WikiWallCard[]
  onShowWallCard: (pageId: string) => void
  onShowWall: () => void
  onOpenWallDoc: (file: string) => void
  onGenerateCard: (pageId: string) => Promise<string | null>
  /** 项目根:标签颜色按项目分开存 */
  rootPath: string
  /** 点标签 = 以该标签搜索 */
  onSearchTag?: (tag: string) => void
  hidden: ReadonlySet<GraphPanelSectionId>
  /** 「显示项」拖出来的区块顺序 */
  order: readonly GraphPanelSectionId[]
}

const noopReveal = (): void => undefined

/** 一个区块的正文块;数据不够就交 null */
function fileSection(
  id: GraphPanelSectionId,
  dep: DepGraphNode | undefined,
  details: ModuleDetails | null,
  colorOf: (moduleId: string) => string
): React.ReactNode {
  switch (id) {
    case 'refs':
      return dep ? (
        <p className="graph-panel-note">
          引用了 {dep.outCount} 个文件,被 {dep.inCount} 个文件引用
        </p>
      ) : null
    case 'module':
      return details ? (
        <section className="graph-panel-section">
          <h3 className="graph-panel-h">所属模块</h3>
          <ModuleChip name={details.name} color={colorOf(details.module.id)} />
        </section>
      ) : null
    case 'files':
      return details ? <ModuleFilesSection details={details} /> : null
    case 'tests':
      return details ? <ModuleTestsSection details={details} /> : null
    case 'styles':
      return details ? <ModuleStylesSection details={details} /> : null
    case 'dependsOn':
      return details ? (
        <ModuleLinksSection title="依赖的模块" links={details.dependsOn} colorOf={colorOf} />
      ) : null
    case 'usedBy':
      return details ? (
        <ModuleLinksSection title="被这些模块使用" links={details.usedBy} colorOf={colorOf} />
      ) : null
    default:
      return null
  }
}

/** Wiki 区块:卡认领走第二版展示;旧版有记录给旧版提示;其余沿用旧区块(损坏与散件组未生成) */
function wikiSection(props: GraphFileBodyProps): React.ReactNode {
  const damaged = props.wiki?.damaged ?? false
  if (damaged) {
    return (
      <GraphWikiSection
        page={null}
        groupName={null}
        damaged
        revealDoc={noopReveal}
        rootPath={props.rootPath}
        onSearchTag={props.onSearchTag}
      />
    )
  }
  const cardOwner = cardOwnerOf(props.wallCards, props.node.id)
  if (cardOwner !== null) {
    return (
      <GraphWikiCardSection
        owner={cardOwner}
        onOpenDoc={props.onOpenWallDoc}
        onShowCard={props.onShowWallCard}
        onGenerate={props.onGenerateCard}
      />
    )
  }
  const owner = wikiOwnerOf(props.wiki, props.node.id)
  const hasPage = owner.page !== null && owner.page.status !== 'none'
  const hasLegacyRecords = (props.wiki?.pages.size ?? 0) > 0
  if (hasLegacyRecords && (hasPage || owner.groupName !== null)) {
    return <GraphWikiLegacyNote onShowWall={props.onShowWall} />
  }
  if (!hasPage && owner.groupName === null) return null
  return (
    <GraphWikiSection
      page={owner.page}
      groupName={owner.groupName}
      damaged={false}
      revealDoc={props.wiki?.revealDoc ?? noopReveal}
      rootPath={props.rootPath}
      onSearchTag={props.onSearchTag}
    />
  )
}

export function GraphFileBody(props: GraphFileBodyProps): React.JSX.Element {
  const { node, modules, depNodes, dirRel, colorOf, moduleNames, hidden, order } = props
  const dep = depNodes.get(node.id)
  const moduleId =
    modules && Object.hasOwn(modules.fileToModule, node.id) ? modules.fileToModule[node.id] : null
  const details = modules && moduleId ? moduleDetails(modules, moduleId, dirRel, moduleNames) : null
  return (
    <>
      {order.map((id) => {
        if (hidden.has(id)) return null
        const block = id === 'wiki' ? wikiSection(props) : fileSection(id, dep, details, colorOf)
        return block === null ? null : <Fragment key={id}>{block}</Fragment>
      })}
      {!modules && <p className="graph-panel-note">模块划分暂不可用,先按原始结构显示</p>}
      {modules && !details && <p className="graph-panel-note">未归入任何模块</p>}
    </>
  )
}
