// 侧栏要展示的模块信息:成员按文件夹分组、相关自测、附挂样式、与其他模块的连线、文件夹的模块构成、
// 未归类原因。纯函数,只读 ModuleMap,不依赖 DOM。
import type { ModuleInfo, ModuleMap } from '@shared/types'
import { moduleDisplayName } from './moduleOverlay.ts'

const STYLE_EXT = /\.(css|scss|sass|less)$/i

export type MemberRole = 'member' | 'attached' | 'test'

export interface MemberFile {
  path: string
  name: string
  role: MemberRole
  /** 不在当前所看的文件夹里(侧栏标「在其他文件夹」) */
  isElsewhere: boolean
}

export interface FolderGroup {
  folder: string
  files: MemberFile[]
}

export interface ModuleLinkView {
  moduleId: string
  name: string
  weight: number
}

export interface ModuleDetails {
  module: ModuleInfo
  name: string
  /** 正式成员 + 附挂的非样式文件,按文件夹分组(文件夹与文件都按路径排序) */
  groups: FolderGroup[]
  styles: string[]
  tests: string[]
  dependsOn: ModuleLinkView[]
  usedBy: ModuleLinkView[]
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

function isUnder(path: string, dirRel: string): boolean {
  return dirRel === '' || path.startsWith(dirRel + '/')
}

function groupFiles(m: ModuleInfo, dirRel: string): FolderGroup[] {
  const attached = new Set(m.attached)
  const tests = new Set(m.tests)
  const groups = new Map<string, MemberFile[]>()
  for (const path of m.files) {
    if (tests.has(path) || STYLE_EXT.test(path)) continue
    const role: MemberRole = attached.has(path) ? 'attached' : 'member'
    const file = { path, name: nameOf(path), role, isElsewhere: !isUnder(path, dirRel) }
    groups.set(dirOf(path), [...(groups.get(dirOf(path)) ?? []), file])
  }
  return [...groups].map(([folder, files]) => ({ folder, files }))
}

function linkViews(map: ModuleMap, moduleId: string, side: 'from' | 'to'): ModuleLinkView[] {
  const other = side === 'from' ? 'to' : 'from'
  const byId = new Map(map.modules.map((m) => [m.id, m]))
  return map.links
    .filter((l) => l[side] === moduleId)
    .map((l) => {
      const target = byId.get(l[other])
      return {
        moduleId: l[other],
        name: target ? moduleDisplayName(target) : l[other],
        weight: l.weight
      }
    })
    .sort((a, b) => b.weight - a.weight || (a.moduleId < b.moduleId ? -1 : 1))
}

export function moduleDetails(
  map: ModuleMap,
  moduleId: string,
  dirRel: string
): ModuleDetails | null {
  const module = map.modules.find((m) => m.id === moduleId)
  if (!module) return null
  return {
    module,
    name: moduleDisplayName(module),
    groups: groupFiles(module, dirRel),
    styles: module.attached.filter((f) => STYLE_EXT.test(f)),
    tests: module.tests,
    dependsOn: linkViews(map, moduleId, 'from'),
    usedBy: linkViews(map, moduleId, 'to')
  }
}

export interface FolderShare {
  moduleId: string
  name: string
  files: number
}

/** 文件夹(含子目录)里各模块的文件数,按文件数降序、id 升序;未归类的文件不计 */
export function folderComposition(map: ModuleMap, folder: string): FolderShare[] {
  const counts = new Map<string, number>()
  for (const [file, moduleId] of Object.entries(map.fileToModule)) {
    if (isUnder(file, folder)) counts.set(moduleId, (counts.get(moduleId) ?? 0) + 1)
  }
  const byId = new Map(map.modules.map((m) => [m.id, m]))
  return [...counts]
    .map(([moduleId, files]) => {
      const m = byId.get(moduleId)
      return { moduleId, files, name: m ? moduleDisplayName(m) : moduleId }
    })
    .sort((a, b) => b.files - a.files || (a.moduleId < b.moduleId ? -1 : 1))
}

/** 未归类文件的原因(侧栏原话) */
export function unassignedReason(relPath: string): string {
  return dirOf(relPath) === ''
    ? '项目根目录下的文件不参与模块划分'
    : '所在目录里没有可划分的代码模块'
}
