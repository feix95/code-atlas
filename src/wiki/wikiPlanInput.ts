// 规划输入装配:把依赖图、事实缓存结构与文件清单拼成主题树规划的输入。
// 依赖图构建会顺带刷新事实缓存,保证随后证据层读到的事实与本次规划同源。
import type { DepEdge } from '../shared/types.ts'
import type { WikiPlanFileInput, WikiPlanInput } from './wikiPlanTypes.ts'

export interface WikiPlanGraphNode {
  relPath: string
  languageId: string
  inCount: number
  outCount: number
}

export interface WikiPlanStructure {
  languageId: string
  exports: string[]
  functions: string[]
  classes: string[]
  reactComponents: string[]
}

export interface WikiPlanInputDeps {
  /** 构建依赖图;实现方同时负责把文件结构写入事实缓存 */
  buildGraph: (rootPath: string) => Promise<{ nodes: WikiPlanGraphNode[]; edges: DepEdge[] }>
  /** 项目内全部文件的相对路径(正斜杠),含非代码文件 */
  listFiles: (rootPath: string) => Promise<string[]>
  fileSize: (rootPath: string, relPath: string) => Promise<number>
  structureOf: (relPath: string) => WikiPlanStructure | null
  /** 清单文件与其中登记的脚本名;无清单时为 null */
  readManifest: (rootPath: string) => Promise<{ path: string; scripts: string[] } | null>
}

export async function assembleWikiPlanInput(
  rootPath: string,
  projectName: string,
  deps: WikiPlanInputDeps
): Promise<WikiPlanInput> {
  const graph = await deps.buildGraph(rootPath)
  const nodeByPath = new Map(graph.nodes.map((node) => [node.relPath, node]))
  const allPaths = (await deps.listFiles(rootPath)).slice().sort()
  const files: WikiPlanFileInput[] = []
  for (const relPath of allPaths) {
    const node = nodeByPath.get(relPath)
    const structure = deps.structureOf(relPath)
    files.push({
      relPath,
      languageId: node?.languageId ?? structure?.languageId ?? '',
      sizeBytes: await deps.fileSize(rootPath, relPath),
      exports: structure?.exports ?? [],
      functions: structure?.functions ?? [],
      classes: structure?.classes ?? [],
      reactComponents: structure?.reactComponents ?? [],
      inCount: node?.inCount ?? 0,
      outCount: node?.outCount ?? 0
    })
  }
  const manifest = await deps.readManifest(rootPath)
  return {
    projectName,
    files,
    edges: graph.edges,
    rootDocs: allPaths.filter((path) => !path.includes('/') && /\.md$/i.test(path)),
    manifestPath: manifest?.path ?? null,
    manifestScripts: manifest?.scripts ?? []
  }
}
