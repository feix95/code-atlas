// 「显示项」菜单只列当前节点真能显示出来的区块:开关全开却整片空白会让人以为坏了。
// 纯函数,只读模块表、引用表与扫描树;不依赖 DOM。
import type { LevelNode } from '../../../shared/graphView.ts'
import type { GroupTree } from '../../../shared/hierarchy.ts'
import type { DepGraphNode, ModuleInfo, ModuleMap } from '@shared/types'
import type { WikiPanelPage } from '@shared/wikiTypes'
import { STYLE_EXT } from './fileKinds.ts'
import { graphPanelKindOf, type GraphPanelSectionId } from './graphPanelSections.ts'

export interface GraphPanelSources {
  node: LevelNode
  modules: ModuleMap | null
  depNodes: ReadonlyMap<string, DepGraphNode>
  tree: GroupTree
  /** 当前语种下这个文件的 Wiki 页;还没生成或没读到为 null */
  wikiPage?: WikiPanelPage | null
  /** 散件文件所属组名:即使还没生成 Wiki,也有一行归属可看 */
  wikiGroup?: string | null
  /** 记账损坏:给一行提示,不摆空内容 */
  wikiDamaged?: boolean
}

function moduleOf(map: ModuleMap | null, file: string): ModuleInfo | null {
  if (!map || !Object.hasOwn(map.fileToModule, file)) return null
  const id = map.fileToModule[file]
  return map.modules.find((m) => m.id === id) ?? null
}

/** 模块里有没有正文会列出的成员(自测与纯样式走各自区块,不算模块文件) */
function hasListedFiles(m: ModuleInfo): boolean {
  const tests = new Set(m.tests)
  return m.files.some((file) => !tests.has(file) && !STYLE_EXT.test(file))
}

function hasDescendantFiles(map: ModuleMap, folder: string): boolean {
  const prefix = folder === '' ? '' : folder + '/'
  return Object.keys(map.fileToModule).some((file) => file.startsWith(prefix))
}

export function availableGraphPanelSections(
  sources: GraphPanelSources
): ReadonlySet<GraphPanelSectionId> {
  const { node, modules, depNodes, tree, wikiPage, wikiGroup, wikiDamaged } = sources
  const ids = new Set<GraphPanelSectionId>()
  const kind = graphPanelKindOf(node)
  if (kind === 'file') {
    // 有生成的说明、散件至少能说出所属组,或记账损坏需要提示,才摆这一块
    if (wikiDamaged || (wikiPage && wikiPage.status !== 'none') || wikiGroup) ids.add('wiki')
    if (depNodes.has(node.id)) ids.add('refs')
    const m = moduleOf(modules, node.id)
    if (m) {
      ids.add('module')
      if (hasListedFiles(m)) ids.add('files')
      if (m.tests.length > 0) ids.add('tests')
      if (m.attached.some((file) => STYLE_EXT.test(file))) ids.add('styles')
      if (modules?.links.some((link) => link.from === m.id)) ids.add('dependsOn')
      if (modules?.links.some((link) => link.to === m.id)) ids.add('usedBy')
    }
    return ids
  }
  if (kind === 'folder') {
    if (tree.has(node.id)) ids.add('contents')
    if (modules && hasDescendantFiles(modules, node.id)) ids.add('composition')
  }
  return ids
}
