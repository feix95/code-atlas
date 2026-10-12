// 工作台设计文档的渲染端仓库:节点列表 + 当前选中。模块单例 + 订阅(同 artboardPrefsStore 的做法),
// 切页签、撕成子窗都不丢;暂只在内存里,关掉软件即清空(保存方案是以后的步骤)。
// 节点修改一律经 dispatch(NodeAction),与撤销 / AI 修改共用同一入口。
// 撤销模型:快照式历史(@shared/uiWorkbench/history)。手势(beginBatch~endBatch)收成一步;
// 批次之外的单次 dispatch(面板回车、Delete)各记一步;只改选中的 select 不入账。
import { useSyncExternalStore } from 'react'
// 相对路径而非 @shared:自测脚本是裸 node 跑的,不认 tsconfig 的 paths 别名
import {
  applyNodeAction,
  type NodeAction,
  type RectNode
} from '../../../shared/uiWorkbench/node.ts'
import {
  emptyHistory,
  pushHistory,
  redoHistory,
  sameNodes,
  undoHistory,
  type DocHistory,
  type Snapshot
} from '../../../shared/uiWorkbench/history.ts'

export interface WorkbenchDocState {
  nodes: readonly RectNode[]
  selectedId: string | null
  /** 撤销/重做栈状态,供按钮置灰;每次提交时随历史刷新 */
  canUndo: boolean
  canRedo: boolean
}

let state: WorkbenchDocState = { nodes: [], selectedId: null, canUndo: false, canRedo: false }
let history: DocHistory = emptyHistory()
// 手势批次:深度计数支持嵌套(如画矩形 = 外层批次包住 trackPointer 的内层批次);
// 批次起点的基准快照只在最外层结算时入栈
let batchDepth = 0
let batchBase: Snapshot | null = null
const listeners = new Set<() => void>()

function commit(next: Pick<WorkbenchDocState, 'nodes' | 'selectedId'>): void {
  state = {
    ...next,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0
  }
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

/** 恢复快照:选中可能指向已不存在的节点(如撤销「选中后删除」),兜底置空 */
function restore(snap: Snapshot): void {
  const selectedId =
    snap.selectedId && snap.nodes.some((n) => n.id === snap.selectedId) ? snap.selectedId : null
  commit({ nodes: snap.nodes, selectedId })
}

export const docActions = {
  dispatch(action: NodeAction): void {
    const before = state
    const nodes = applyNodeAction(state.nodes, action)
    // 批次内只更新画面不入账;批次外的真改动(no-op 除外)立即记一步
    if (batchDepth === 0 && !sameNodes(nodes, before.nodes)) {
      history = pushHistory(history, { nodes: before.nodes, selectedId: before.selectedId })
    }
    const removed = action.type === 'remove' && action.id === state.selectedId
    commit({ nodes, selectedId: removed ? null : state.selectedId })
  },
  select(id: string | null): void {
    if (id !== state.selectedId) commit({ nodes: state.nodes, selectedId: id })
  },
  /** 手势/复合动作开始:期间的 dispatch 只改画面,最外层 endBatch 才记一步 */
  beginBatch(): void {
    batchDepth += 1
    if (batchDepth === 1) batchBase = { nodes: state.nodes, selectedId: state.selectedId }
  },
  endBatch(): void {
    if (batchDepth === 0) return
    batchDepth -= 1
    if (batchDepth !== 0) return
    const base = batchBase
    batchBase = null
    // 拖回原位、纯点击选中:净变化为零,不入账
    if (base && !sameNodes(state.nodes, base.nodes)) {
      history = pushHistory(history, base)
      // 结算时未必有 dispatch 兜底刷新,这里补一次让 canUndo/canRedo 跟上
      commit({ nodes: state.nodes, selectedId: state.selectedId })
    }
  },
  undo(): void {
    if (batchDepth > 0) return
    const r = undoHistory(history, { nodes: state.nodes, selectedId: state.selectedId })
    if (!r) return
    history = r.history
    restore(r.restore)
  },
  redo(): void {
    if (batchDepth > 0) return
    const r = redoHistory(history, { nodes: state.nodes, selectedId: state.selectedId })
    if (!r) return
    history = r.history
    restore(r.restore)
  }
}

export function selectedNode(s: WorkbenchDocState): RectNode | null {
  return s.nodes.find((n) => n.id === s.selectedId) ?? null
}
