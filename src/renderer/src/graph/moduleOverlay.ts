// 划分叠加层(P1):把程序切出的模块映射到当前层级的可见节点上。
// 文件节点直接属于它的模块;未展开的文件夹按后代文件的模块构成画分段色环,
// 某模块占比够高时文件夹也计入该模块轮廓。外部节点与 overflow 节点不参与。纯函数,不依赖 DOM。
import type { LevelNode } from '@shared/graphView'
import type { ModuleInfo, ModuleMap } from '@shared/types'
import { GRAPH_HULL, GRAPH_MODULE_COLORS, GRAPH_RING } from './graphConfig.ts'

/** 色环里合并剩余模块的中性段在自测与读屏描述里的记号 */
export const NEUTRAL_SEGMENT = 'other'

export interface RingSegment {
  /** null = 中性色段(超出 maxSegments 的模块合并) */
  moduleId: string | null
  /** 弧长占比 0..1 */
  share: number
  files: number
}

export interface NodeModuleInfo {
  /** 计入哪个模块的轮廓与聚类力;null = 不计入 */
  hullModule: string | null
  /** 文件夹节点的色环;文件节点为空 */
  ring: RingSegment[]
}

export interface ModuleOverlay {
  nodes: Map<string, NodeModuleInfo>
  /** 模块 id → 当前屏幕上的轮廓成员节点 id(只收 2 个及以上成员的模块) */
  hulls: Map<string, string[]>
  /** 模块 id → 调色板下标(按文件数降序、id 升序后循环取色) */
  colorOf: Map<string, number>
  byId: Map<string, ModuleInfo>
}

const EMPTY_OVERLAY: ModuleOverlay = {
  nodes: new Map(),
  hulls: new Map(),
  colorOf: new Map(),
  byId: new Map()
}

/** 模块显示名(P1–P2,无 AI):锚点所在目录名 · 锚点文件名 */
export function moduleDisplayName(m: ModuleInfo): string {
  const folderName = m.folder === '' ? '根目录' : m.folder.slice(m.folder.lastIndexOf('/') + 1)
  return `${folderName} · ${m.anchor.slice(m.anchor.lastIndexOf('/') + 1)}`
}

/** 当前层级下每个文件夹节点的后代文件按模块计数 */
function countByFolder(map: ModuleMap, dirRel: string): Map<string, Map<string, number>> {
  const prefix = dirRel === '' ? '' : dirRel + '/'
  const counts = new Map<string, Map<string, number>>()
  for (const [file, moduleId] of Object.entries(map.fileToModule)) {
    if (!file.startsWith(prefix)) continue
    const slash = file.indexOf('/', prefix.length)
    if (slash < 0) continue
    const folder = file.slice(0, slash)
    const perModule = counts.get(folder) ?? new Map<string, number>()
    perModule.set(moduleId, (perModule.get(moduleId) ?? 0) + 1)
    counts.set(folder, perModule)
  }
  return counts
}

/** 按文件数降序、id 升序切段;超出上限的合并成中性段 */
function ringOf(perModule: Map<string, number>): RingSegment[] {
  const total = [...perModule.values()].reduce((s, n) => s + n, 0)
  const ranked = [...perModule].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const fits = ranked.length <= GRAPH_RING.maxSegments
  const shown = fits ? ranked : ranked.slice(0, GRAPH_RING.maxSegments - 1)
  const segments: RingSegment[] = shown.map(([moduleId, files]) => ({
    moduleId,
    files,
    share: files / total
  }))
  if (!fits) {
    const files = ranked.slice(shown.length).reduce((s, [, n]) => s + n, 0)
    segments.push({ moduleId: null, files, share: files / total })
  }
  return segments
}

function folderInfo(perModule: Map<string, number> | undefined): NodeModuleInfo {
  if (!perModule) return { hullModule: null, ring: [] }
  const ring = ringOf(perModule)
  const top = ring[0]
  const isDominant = top.moduleId !== null && top.share >= GRAPH_HULL.folderDominantShare
  return { hullModule: isDominant ? top.moduleId : null, ring }
}

export function buildModuleOverlay(
  nodes: LevelNode[],
  dirRel: string,
  map: ModuleMap | null
): ModuleOverlay {
  if (!map || map.modules.length === 0) return EMPTY_OVERLAY
  const folders = countByFolder(map, dirRel)
  const infos = new Map<string, NodeModuleInfo>()
  const members = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.kind !== 'file' && n.kind !== 'folder') continue
    const info =
      n.kind === 'folder'
        ? folderInfo(folders.get(n.id))
        : {
            hullModule: Object.hasOwn(map.fileToModule, n.id) ? map.fileToModule[n.id] : null,
            ring: []
          }
    infos.set(n.id, info)
    if (info.hullModule)
      members.set(info.hullModule, [...(members.get(info.hullModule) ?? []), n.id])
  }
  return {
    nodes: infos,
    // 最顶层只画彩色环:顶层文件夹往往横跨多个模块,轮廓既挤又容易误读
    hulls: dirRel === '' ? new Map() : new Map([...members].filter(([, ids]) => ids.length >= 2)),
    colorOf: new Map(map.modules.map((m, i) => [m.id, i % GRAPH_MODULE_COLORS])),
    byId: new Map(map.modules.map((m) => [m.id, m]))
  }
}
