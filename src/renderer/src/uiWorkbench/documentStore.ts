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
  /** 多选集(框选/Shift 加减选):按加入顺序排列 */
  selectedIds: readonly string[]
  /** 恰为单选时的节点 id;空选/多选为 null——单对象手势(缩放/圆角/旋转)与面板吃它 */
  selectedId: string | null
  /** 撤销/重做栈状态,供按钮置灰;每次提交时随历史刷新 */
  canUndo: boolean
  canRedo: boolean
}

let state: WorkbenchDocState = {
  nodes: [],
  selectedIds: [],
  selectedId: null,
  canUndo: false,
  canRedo: false
}
let history: DocHistory = emptyHistory()
// 手势批次:深度计数支持嵌套(如画矩形 = 外层批次包住 trackPointer 的内层批次);
// 批次起点的基准快照只在最外层结算时入栈
let batchDepth = 0
let batchBase: Snapshot | null = null
const listeners = new Set<() => void>()

function commit(next: Pick<WorkbenchDocState, 'nodes' | 'selectedIds'>): void {
  state = {
    nodes: next.nodes,
    selectedIds: next.selectedIds,
    selectedId: next.selectedIds.length === 1 ? next.selectedIds[0] : null,
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

/** 恢复快照:选集里可能有已不存在的节点(如撤销「多选后删除」),按现存活节点过滤 */
function restore(snap: Snapshot): void {
  const alive = new Set(snap.nodes.map((n) => n.id))
  commit({ nodes: snap.nodes, selectedIds: snap.selectedIds.filter((id) => alive.has(id)) })
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

export const docActions = {
  dispatch(action: NodeAction): void {
    const before = state
    const nodes = applyNodeAction(state.nodes, action)
    // 批次内只更新画面不入账;批次外的真改动(no-op 除外)立即记一步
    if (batchDepth === 0 && !sameNodes(nodes, before.nodes)) {
      history = pushHistory(history, { nodes: before.nodes, selectedIds: before.selectedIds })
    }
    // 被删节点从选集剔除;其余动作不动选集
    const selectedIds =
      action.type === 'remove'
        ? state.selectedIds.filter((id) => id !== action.id)
        : state.selectedIds
    commit({ nodes, selectedIds })
  },
  /** 替换选集:null/[] = 清空(点空白、Esc) */
  select(id: string | null): void {
    docActions.selectIds(id === null ? [] : [id])
  },
  selectIds(ids: readonly string[]): void {
    if (!sameIds(ids, state.selectedIds)) {
      commit({ nodes: state.nodes, selectedIds: [...ids] })
    }
  },
  /** Shift+点击:在选集里则剔除,不在则追加(Figma 式加减选) */
  toggleSelect(id: string): void {
    docActions.selectIds(
      state.selectedIds.includes(id)
        ? state.selectedIds.filter((s) => s !== id)
        : [...state.selectedIds, id]
    )
  },
  /** 手势/复合动作开始:期间的 dispatch 只改画面,最外层 endBatch 才记一步 */
  beginBatch(): void {
    batchDepth += 1
    if (batchDepth === 1) batchBase = { nodes: state.nodes, selectedIds: state.selectedIds }
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
      commit({ nodes: state.nodes, selectedIds: state.selectedIds })
    }
  },
  undo(): void {
    if (batchDepth > 0) return
    const r = undoHistory(history, { nodes: state.nodes, selectedIds: state.selectedIds })
    if (!r) return
    history = r.history
    restore(r.restore)
  },
  redo(): void {
    if (batchDepth > 0) return
    const r = redoHistory(history, { nodes: state.nodes, selectedIds: state.selectedIds })
    if (!r) return
    history = r.history
    restore(r.restore)
  }
}

/** 恰为单选时返回该节点(单对象手势与属性面板专用);多选/空选返回 null */
export function selectedNode(s: WorkbenchDocState): RectNode | null {
  return s.nodes.find((n) => n.id === s.selectedId) ?? null
}

/** 选中的全部节点,按文档顺序(覆盖层与整组操作共用) */
export function selectedNodes(s: WorkbenchDocState): RectNode[] {
  const ids = new Set(s.selectedIds)
  return s.nodes.filter((n) => ids.has(n.id))
}
