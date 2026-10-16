// 样式组仓库(渲染端):把选中的若干对象存成 JSON 片段,存本机,关掉重开不丢;
// 放入画板时是散开的普通对象(与片段不再关联),整次放入合成一步撤销。
import {
  buildGroup,
  groupSize,
  instantiateGroup,
  sanitizeGroups,
  type StyleGroup
} from '@shared/uiWorkbench/groups'
import { removeStylePreset, saveStylePreset } from '@shared/uiWorkbench/styles'
import { contextFrame, reparentPatches } from '@shared/uiWorkbench/tree'
import { getArtboardPrefs } from './artboardPrefsStore'
import { docActions, getDocState, selectedNodes } from './documentStore'
import { createPersistentList } from './persistentList'

/** 连续放入同一个组时,每次错开的像素(同 Ctrl+V 的逐级偏移,免得叠成一堆看不出放进来了) */
const INSERT_CASCADE_PX = 10

const store = createPersistentList<StyleGroup>('atlas.uiWorkbench.groups', '样式组', sanitizeGroups)

export const useGroups = store.use as () => StyleGroup[]
export const getGroups = store.get as () => StyleGroup[]

/** 最近一次放入:只有「刚放入的这批对象仍是当前选中」时再放同一个组才逐级错开,否则回画板中央 */
let lastInsert: { groupId: string; count: number; ids: readonly string[] } | null = null

function isSameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

export const groupActions = {
  /** 把当前选中的对象存成样式组:同名覆盖沿用原 id;没有选中对象返回 null */
  saveSelection(rawName: string): { id: string; overwrote: boolean } | null {
    // 画板不进样式组(散开的素材),只选了画板就当没选
    const picked = selectedNodes(getDocState()).filter((n) => n.type !== 'frame')
    if (picked.length === 0) return null
    const groups = getGroups()
    const built = buildGroup(crypto.randomUUID(), rawName, groups.length + 1, picked)
    const r = saveStylePreset(groups, built)
    store.set(r.list)
    return { id: r.id, overwrote: r.overwrote }
  },
  /** 放入当前画板(选中对象所在画板,否则第一个顶层画板;页面没有画板就放在页面原点):
   *  整组居中落位,按落点认爹,整体选中;一次放入 = 一步撤销 */
  insert(id: string): void {
    const group = getGroups().find((g) => g.id === id)
    if (!group) return
    const frame = contextFrame(getDocState().nodes, getDocState().selectedIds)
    const board = frame ?? { x: 0, y: 0, ...getArtboardPrefs().last }
    const size = groupSize(group)
    const isChained =
      lastInsert?.groupId === id && isSameIds(lastInsert.ids, getDocState().selectedIds)
    const cascade = isChained && lastInsert ? lastInsert.count : 0
    const topLeft = {
      x: board.x + Math.round((board.width - size.width) / 2) + cascade * INSERT_CASCADE_PX,
      y: board.y + Math.round((board.height - size.height) / 2) + cascade * INSERT_CASCADE_PX
    }
    const made = instantiateGroup(group, getDocState().nodes, topLeft)
    docActions.beginBatch()
    try {
      for (const node of made) docActions.dispatch({ type: 'add', node })
      const parents = reparentPatches(
        getDocState().nodes,
        made.map((n) => n.id)
      )
      for (const { id: nodeId, parentId } of parents) {
        docActions.dispatch({ type: 'update', id: nodeId, patch: { parentId } })
      }
      docActions.selectIds(made.map((n) => n.id))
    } finally {
      docActions.endBatch()
    }
    lastInsert = { groupId: id, count: cascade + 1, ids: made.map((n) => n.id) }
  },
  remove(id: string): void {
    store.set(removeStylePreset(getGroups(), id))
  }
}
