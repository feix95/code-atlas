// 工作台设计文档的渲染端仓库:页面列表(每页 = 画布底色 + 画板尺寸 + 节点列表)+ 当前页 + 当前选中。
// 模块单例 + 订阅(同 artboardPrefsStore 的做法),切页签、拆成子窗都不丢;
// 暂只在内存里,关掉软件即清空(保存方案是以后的步骤)。
// 节点修改一律经 dispatch(NodeAction,作用于当前页),与撤销 / AI 修改共用同一入口;页面级修改走 docActions 的 page 系列。
// 撤销模型:快照式历史(@shared/uiWorkbench/history)。手势(beginBatch~endBatch)收成一步;
// 批次之外的单次 dispatch(面板回车、Delete)各记一步;只改选中的 select、只切页的 switchPage 不入账。
import { useSyncExternalStore } from 'react'
import { createFrame, type BoxNode } from '../../../shared/uiWorkbench/frame.ts'
import type { LineNode } from '../../../shared/uiWorkbench/line.ts'
import type { RectNode } from '../../../shared/uiWorkbench/node.ts'
// 相对路径而非 @shared:自测脚本是裸 node 跑的,不认 tsconfig 的 paths 别名
import { getArtboardPrefs } from './artboardPrefsStore.ts'
import {
  activeAfterRemove,
  applyNodeActionToPage,
  createPage,
  defaultPageBackground,
  patchPage,
  removePage,
  reorderPage,
  type Page,
  type PagePatch
} from '../../../shared/uiWorkbench/page.ts'
import type { NodeAction, SceneNode } from '../../../shared/uiWorkbench/scene.ts'
import { subtreeIds } from '../../../shared/uiWorkbench/tree.ts'
import {
  emptyHistory,
  pushHistory,
  redoHistory,
  samePages,
  undoHistory,
  type DocHistory,
  type Snapshot
} from '../../../shared/uiWorkbench/history.ts'

export interface WorkbenchDocState {
  pages: readonly Page[]
  activePageId: string
  /** 当前页;pages 永远至少一页 */
  activePage: Page
  /** 当前页的节点列表(= activePage.nodes),数组顺序即 z 序,越靠后越在上层 */
  nodes: readonly SceneNode[]
  /** 多选集(框选/Shift 加减选):按加入顺序排列 */
  selectedIds: readonly string[]
  /** 恰为单选时的节点 id;空选/多选为 null——单对象手势(缩放/圆角/旋转)与面板吃它 */
  selectedId: string | null
  /** 撤销/重做栈状态,供按钮置灰;每次提交时随历史刷新 */
  canUndo: boolean
  canRedo: boolean
}

type DocCore = Pick<Snapshot, 'pages' | 'activePageId' | 'selectedIds'>

function buildState(core: DocCore, hist: DocHistory): WorkbenchDocState {
  const activePage = core.pages.find((p) => p.id === core.activePageId) ?? core.pages[0]
  return {
    pages: core.pages,
    activePageId: activePage.id,
    activePage,
    nodes: activePage.nodes,
    selectedIds: core.selectedIds,
    selectedId: core.selectedIds.length === 1 ? core.selectedIds[0] : null,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0
  }
}

/** 第一页的底色跟随创建时的明暗主题(Figma 同款);自测里没有 document,按浅色算 */
const IS_DARK_THEME =
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
/** 新文档的第一页:默认预置一个画板,尺寸沿用本机记住的上次尺寸(重启后不回到出厂尺寸);之后新建的页是空的 */
function freshFirstPage(isSeeded: boolean): Page {
  return {
    ...createPage([], undefined, { background: defaultPageBackground(IS_DARK_THEME) }),
    nodes: isSeeded ? [createFrame([], { x: 0, y: 0, ...getArtboardPrefs().last })] : []
  }
}
const FIRST_PAGE = freshFirstPage(true)
let history: DocHistory = emptyHistory()
let state: WorkbenchDocState = buildState(
  { pages: [FIRST_PAGE], activePageId: FIRST_PAGE.id, selectedIds: [] },
  history
)
// 手势批次:深度计数支持嵌套(如画矩形 = 外层批次包住 trackPointer 的内层批次);
// 批次起点的基准快照只在最外层结算时入栈
let batchDepth = 0
let batchBase: Snapshot | null = null
const listeners = new Set<() => void>()

function commit(next: DocCore): void {
  state = buildState(next, history)
  for (const cb of listeners) cb()
}

function snapshotOf(s: WorkbenchDocState): Snapshot {
  return { pages: s.pages, activePageId: s.activePageId, selectedIds: s.selectedIds }
}

/** 文档内容改动:批次外的真改动(no-op 除外)立即记一步,批次内只更新画面 */
function change(next: DocCore): void {
  if (batchDepth === 0 && !samePages(next.pages, state.pages)) {
    history = pushHistory(history, snapshotOf(state))
  }
  commit(next)
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

/** 恢复快照:跳回动作发生的页;选集里可能有已不存在的节点(如撤销「多选后删除」),按现存活节点过滤 */
function restore(snap: Snapshot): void {
  const page = snap.pages.find((p) => p.id === snap.activePageId) ?? snap.pages[0]
  const alive = new Set(page.nodes.map((n) => n.id))
  commit({
    pages: snap.pages,
    activePageId: page.id,
    selectedIds: snap.selectedIds.filter((id) => alive.has(id))
  })
}

/** 撤销/重做压进对侧栈的「当前」快照:所在页对齐到「目标与当前之间内容不同的那一页」(那一页在当前还存在的话),
 *  这样来回撤销重做都落在动作发生的那一页(新建页的重做落在新页);找不到差异页就沿用当前所在页 */
function currentFacing(target: Snapshot): Snapshot {
  const current = snapshotOf(state)
  const changed = current.pages.find((page) => {
    const old = target.pages.find((p) => p.id === page.id)
    return !old || !samePages([old], [page])
  })
  return changed ? { ...current, activePageId: changed.id } : current
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

export const docActions = {
  dispatch(action: NodeAction): void {
    const pages = applyNodeActionToPage(state.pages, state.activePageId, action)
    // 被删、被隐藏的节点(画板连后代)从选集剔除(隐藏即看不见,不该还留着选中框);其余动作不动选集
    const isDeselecting =
      action.type === 'remove' ||
      (action.type === 'update' && 'visible' in action.patch && action.patch.visible === false)
    const gone = isDeselecting ? new Set(subtreeIds(state.nodes, action.id)) : null
    const selectedIds = gone ? state.selectedIds.filter((id) => !gone.has(id)) : state.selectedIds
    change({ pages, activePageId: state.activePageId, selectedIds })
  },
  /** 替换选集:null/[] = 清空(点空白、Esc) */
  select(id: string | null): void {
    docActions.selectIds(id === null ? [] : [id])
  },
  selectIds(ids: readonly string[]): void {
    if (!sameIds(ids, state.selectedIds)) {
      commit({ pages: state.pages, activePageId: state.activePageId, selectedIds: [...ids] })
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
  /** 切页:清空选中,不入撤销栈(只是换个视角) */
  switchPage(id: string): void {
    if (id === state.activePageId || !state.pages.some((p) => p.id === id)) return
    commit({ pages: state.pages, activePageId: id, selectedIds: [] })
  },
  /** 新建页(继承当前页的底色与画板尺寸)并切过去;入撤销栈,撤销回到原页 */
  addPage(): void {
    const page = createPage(state.pages, state.activePage)
    change({ pages: [...state.pages, page], activePageId: page.id, selectedIds: [] })
  },
  /** 删页:只剩一页时不动;删的是当前页则切到相邻页;靠撤销找回 */
  removePage(id: string): void {
    if (state.pages.length <= 1) return
    const activePageId = activeAfterRemove(state.pages, id, state.activePageId)
    const switched = activePageId !== state.activePageId
    change({
      pages: removePage(state.pages, id),
      activePageId,
      selectedIds: switched ? [] : state.selectedIds
    })
  },
  /** 改页属性(改名、底色、画板尺寸) */
  patchPage(id: string, patch: PagePatch): void {
    change({
      pages: patchPage(state.pages, id, patch),
      activePageId: state.activePageId,
      selectedIds: state.selectedIds
    })
  },
  reorderPage(id: string, toIndex: number): void {
    change({
      pages: reorderPage(state.pages, id, toIndex),
      activePageId: state.activePageId,
      selectedIds: state.selectedIds
    })
  },
  /** 丢弃当前文档、换成全新的一页(清空撤销栈与选中);isSeeded=false 给空白页,自测与「新建文档」共用 */
  resetDocument(isSeeded = true): void {
    const page = freshFirstPage(isSeeded)
    history = emptyHistory()
    batchDepth = 0
    batchBase = null
    commit({ pages: [page], activePageId: page.id, selectedIds: [] })
  },
  /** 手势/复合动作开始:期间的 dispatch 只改画面,最外层 endBatch 才记一步 */
  beginBatch(): void {
    batchDepth += 1
    if (batchDepth === 1) batchBase = snapshotOf(state)
  },
  endBatch(): void {
    if (batchDepth === 0) return
    batchDepth -= 1
    if (batchDepth !== 0) return
    const base = batchBase
    batchBase = null
    // 拖回原位、纯点击选中:净变化为零,不入账
    if (base && !samePages(state.pages, base.pages)) {
      history = pushHistory(history, base)
      // 结算时未必有 dispatch 兜底刷新,这里补一次让 canUndo/canRedo 跟上
      commit({
        pages: state.pages,
        activePageId: state.activePageId,
        selectedIds: state.selectedIds
      })
    }
  },
  undo(): void {
    if (batchDepth > 0) return
    const target = history.past.at(-1)
    if (!target) return
    const r = undoHistory(history, currentFacing(target))
    if (!r) return
    history = r.history
    restore(r.restore)
  },
  redo(): void {
    if (batchDepth > 0) return
    const target = history.future.at(-1)
    if (!target) return
    const r = redoHistory(history, currentFacing(target))
    if (!r) return
    history = r.history
    restore(r.restore)
  }
}

/** 恰为单选且是矩形或画板时返回它(缩放手势专用:这两类共用盒子几何) */
export function selectedBox(s: WorkbenchDocState): BoxNode | null {
  const node = selectedNode(s)
  return node && node.type !== 'line' ? node : null
}

/** 恰为单选时返回该节点(单对象手势与属性面板专用);多选/空选返回 null */
export function selectedNode(s: WorkbenchDocState): SceneNode | null {
  return s.nodes.find((n) => n.id === s.selectedId) ?? null
}

/** 恰为单选且是矩形时返回它(缩放/圆角/旋转手势专用) */
export function selectedRect(s: WorkbenchDocState): RectNode | null {
  const node = selectedNode(s)
  return node?.type === 'rect' ? node : null
}

/** 恰为单选且是直线时返回它(端点拖拽专用) */
export function selectedLine(s: WorkbenchDocState): LineNode | null {
  const node = selectedNode(s)
  return node?.type === 'line' ? node : null
}

/** 选中的全部节点,按文档顺序(覆盖层与整组操作共用) */
export function selectedNodes(s: WorkbenchDocState): SceneNode[] {
  const ids = new Set(s.selectedIds)
  return s.nodes.filter((n) => ids.has(n.id))
}
