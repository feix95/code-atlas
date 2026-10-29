// 悬停看法:鼠标停在文件或文件夹上时,滚轮在几种看法之间切换。纯函数,不依赖 DOM。
// 引用关系 = 进出两个方向的连线;引用了谁 = 只看它指出去的;被谁引用 = 只看指向它的;
// 同模块 = 点亮和它同一模块的全部可见节点(它没有归属模块时跳过这一种)。
export type HoverMode = 'links' | 'uses' | 'usedBy' | 'module'

export const HOVER_MODE_LABEL: Record<HoverMode, string> = {
  links: '引用关系',
  uses: '引用了谁',
  usedBy: '被谁引用',
  module: '同模块'
}

const WITH_MODULE: readonly HoverMode[] = ['links', 'uses', 'usedBy', 'module']
const WITHOUT_MODULE: readonly HoverMode[] = ['links', 'uses', 'usedBy']

export function hoverModesFor(moduleId: string | null): readonly HoverMode[] {
  return moduleId === null ? WITHOUT_MODULE : WITH_MODULE
}

/** 往后切 steps 次(负数往前),首尾相接;当前看法不在列表里时回到第一种 */
export function stepHoverMode(
  current: HoverMode,
  modes: readonly HoverMode[],
  steps: number
): HoverMode {
  const i = modes.indexOf(current)
  if (i < 0) return modes[0]
  const n = modes.length
  return modes[(((i + steps) % n) + n) % n]
}

interface LinkLike {
  source: { id: string }
  target: { id: string }
}

/** 判断节点是否属于某模块(文件节点看归属,文件夹节点看色环里有没有这个模块) */
export type BelongsFn = (nodeId: string, moduleId: string) => boolean

/** 某一种看法下,这条边是否算「相关」(点亮) */
export function isHoverLink(
  l: LinkLike,
  id: string,
  mode: HoverMode,
  belongs: BelongsFn,
  moduleId: string | null
): boolean {
  const s = l.source.id
  const t = l.target.id
  if (mode === 'uses') return s === id
  if (mode === 'usedBy') return t === id
  if (mode === 'module') return moduleId !== null && belongs(s, moduleId) && belongs(t, moduleId)
  return s === id || t === id
}

/** 某一种看法下点亮的节点(总含悬停节点自己) */
export function hoverRelated(
  nodes: readonly { id: string }[],
  links: readonly LinkLike[],
  id: string | null,
  mode: HoverMode,
  belongs: BelongsFn,
  moduleId: string | null
): Set<string> {
  const set = new Set<string>()
  if (id === null) return set
  set.add(id)
  if (mode === 'module') {
    if (moduleId === null) return set
    for (const n of nodes) if (belongs(n.id, moduleId)) set.add(n.id)
    return set
  }
  for (const l of links) {
    if (!isHoverLink(l, id, mode, belongs, moduleId)) continue
    set.add(l.source.id)
    set.add(l.target.id)
  }
  return set
}
