// 工作台设计文档的渲染端仓库:节点列表 + 当前选中。模块单例 + 订阅(同 artboardPrefsStore 的做法),
// 切页签、撕成子窗都不丢;暂只在内存里,关掉软件即清空(保存方案是以后的步骤)。
// 节点修改一律经 dispatch(NodeAction),与日后的撤销 / AI 修改共用同一入口。
import { useSyncExternalStore } from 'react'
import { applyNodeAction, type NodeAction, type RectNode } from '@shared/uiWorkbench/node'

export interface WorkbenchDocState {
  nodes: readonly RectNode[]
  selectedId: string | null
}

let state: WorkbenchDocState = { nodes: [], selectedId: null }
const listeners = new Set<() => void>()

function commit(next: WorkbenchDocState): void {
  state = next
  for (const cb of listeners) cb()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getDocState(): WorkbenchDocState {
  return state
}

export function useDocState(): WorkbenchDocState {
  return useSyncExternalStore(subscribe, getDocState)
}

export const docActions = {
  dispatch(action: NodeAction): void {
    const nodes = applyNodeAction(state.nodes, action)
    const removed = action.type === 'remove' && action.id === state.selectedId
    commit({ nodes, selectedId: removed ? null : state.selectedId })
  },
  select(id: string | null): void {
    if (id !== state.selectedId) commit({ ...state, selectedId: id })
  }
}

export function selectedNode(s: WorkbenchDocState): RectNode | null {
  return s.nodes.find((n) => n.id === s.selectedId) ?? null
}
