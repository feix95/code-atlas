// 文件详情正文:按「显示项」的顺序拼区块。Wiki 说明与模块相关区块各取各的数据源,
// 数据不够的区块不渲染(可用性已在菜单那层算过)。
import { Fragment } from 'react'
import type { LevelNode } from '@shared/graphView'
import type { DepGraphNode, ModuleMap } from '@shared/types'
import { moduleDetails, type ModuleDetails } from '../graph/moduleDetails'
import type { ModuleNames } from '../graph/moduleNames'
import type { GraphPanelSectionId } from '../graph/graphPanelSections'
import { wikiOwnerOf } from '../graph/wikiOwner'
import type { WikiPanelData } from '../useWikiPanel'
import { GraphWikiSection } from './GraphWikiSection'
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

/** Wiki 区块:有记账、散件组归属或损坏提示才出,避免模块文件还没生成时摆一行空标题 */
function wikiSection(props: GraphFileBodyProps): React.ReactNode {
  const owner = wikiOwnerOf(props.wiki, props.node.id)
  const damaged = props.wiki?.damaged ?? false
  const hasPage = owner.page !== null && owner.page.status !== 'none'
  if (!damaged && !hasPage && owner.groupName === null) return null
  return (
    <GraphWikiSection
      page={owner.page}
      groupName={owner.groupName}
      damaged={damaged}
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
