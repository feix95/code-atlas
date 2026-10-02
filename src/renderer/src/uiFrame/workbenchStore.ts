// 工作台界面账(工作台改造):画布视图 + 零件盒定位请求 + 空白底板示例开关 + 方案库浮层。
// 零件盒挂在全局侧栏、画布挂在页签内容区,两棵子树共享这一本账;数据归 docStore/schemeStore 不动。
import { useSyncExternalStore } from 'react'
import type { IconSlot } from '@shared/uiFrame/types'
import type { CanvasView } from './canvasDoc'

/** 定位请求:零件盒/检查面板点条目 → 切到对应视图并滚动到位(图标/变量顺带选中) */
export type JumpTarget =
  | { kind: 'component'; id: string }
  | { kind: 'boardGroup'; group: string }
  | { kind: 'token'; name: string }
  | { kind: 'icon'; slot: IconSlot }

/** 定位目标落在哪个视图:组件条目上零件墙,图标槽位 demo-* 在墙、其余在底板,变量类上变量板 */
export function jumpView(target: JumpTarget): CanvasView {
  if (target.kind === 'component') return 'wall'
  if (target.kind === 'icon') return target.slot.startsWith('demo-') ? 'wall' : 'bench'
  return 'board'
}

interface WorkbenchState {
  /** 画布当前视图;默认底板(§5.3:进来先见「我的 app」,不是零件目录) */
  view: CanvasView
  /** 待消化的定位请求;seq 递增保证同目标重复点也触发 */
  jump: { seq: number; target: JumpTarget } | null
  /** 空白方案的底板是否已填入示例页(纯界面态,不进方案数据) */
  blankExample: boolean
  /** 方案库浮层开关(零件盒「管理」与工具条方案名共用) */
  libraryOpen: boolean
  /** 底板上选中的零件实例 id(M3-a);null = 没选 */
  placedSel: string | null
  /** 零件盒正拖着的配方 id;画布靠它关 iframe 的 pointer-events,让 drop 落在父层 */
  dragPart: string | null
}

let state: WorkbenchState = {
  view: 'bench',
  jump: null,
  blankExample: false,
  libraryOpen: false,
  placedSel: null,
  dragPart: null
}
const listeners = new Set<() => void>()

function emit(patch: Partial<WorkbenchState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export const workbenchActions = {
  setView(view: CanvasView): void {
    // 换视图同一次 emit 清掉底板零件选中:不能靠渲染期回调清,会踩掉同事件里后写的 selectPlaced
    if (state.view !== view) emit({ view, placedSel: null })
  },
  /** 定位:切到目标视图 + 记账等画布消化(画布在目标视图的文档就绪后滚动/选中) */
  jump(target: JumpTarget): void {
    const view = jumpView(target)
    emit({
      view,
      ...(view !== state.view ? { placedSel: null } : {}),
      jump: { seq: (state.jump?.seq ?? 0) + 1, target }
    })
  },
  clearJump(): void {
    if (state.jump) emit({ jump: null })
  },
  fillExample(): void {
    emit({ blankExample: true })
  },
  /** 换方案/重新起步后复位界面态:回底板、清定位、空白底板恢复空态 */
  docReplaced(): void {
    emit({ view: 'bench', jump: null, blankExample: false, placedSel: null })
  },
  setLibraryOpen(open: boolean): void {
    emit({ libraryOpen: open })
  },
  selectPlaced(id: string | null): void {
    if (state.placedSel !== id) emit({ placedSel: id })
  },
  setDragPart(id: string | null): void {
    if (state.dragPart !== id) emit({ dragPart: id })
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useWorkbench(): WorkbenchState {
  return useSyncExternalStore(subscribe, () => state)
}

/** 非订阅读取:键盘处理器等即时场景取最新界面态 */
export function workbenchNow(): WorkbenchState {
  return state
}
