// 选择工具的「拖动对象」手势(从 useCanvasTools 抽出):
// 命中节点先定选集再整组移动;Shift 轴锁;吸附 = 对齐吸附(snap.ts)优先、没吸上的轴再试间距吸附(spacing.ts)。
// 修饰键约定(同类功能同一个键):
//   Shift 轴向锁定;Ctrl/Cmd 单独按住 = 临时关闭全部吸附;
//   Alt 或 Ctrl+Alt 起手 = 拖出副本(原件留原地,副本跟手并被选中),此时 Ctrl 不再关吸附;
//   Alt/Ctrl/Shift 任一按住期间,全程显示被拖对象到四向邻居的间距标注。
// 修饰键中途变化由 trackPointer 原地重放 onMove,标注与吸附随之即时刷新。
import type { Point } from '@shared/uiWorkbench/geometry'
import { translatePatch, unionBox, type SceneNode } from '@shared/uiWorkbench/scene'
import { snapMove, snapTargets, type SnapGuides } from '@shared/uiWorkbench/snap'
import { gapMarks, snapSpacing, type GapMark } from '@shared/uiWorkbench/spacing'
import { cloneTrees, movableSelection, reparentPatches } from '@shared/uiWorkbench/tree'
import { docActions, getDocState } from './documentStore'
import { trackPointer } from './trackPointer'

/** 对齐吸附的命中距离(屏幕像素):除以 zoom 换成设计单位,放得越大吸得越「松」 */
export const SNAP_THRESHOLD_PX = 5

const NO_GUIDES: SnapGuides = { v: null, h: null }

export interface MoveGestureDeps {
  toDesign: (e: { clientX: number; clientY: number }) => Point
  getZoom: () => number
  setGuides: (guides: SnapGuides) => void
  setGaps: (marks: GapMark[]) => void
}

/** 命中节点后定选集:Shift 点已选 = 挂起剔除(单击才剔,拖动仍带它走),Shift 点未选 = 并入,
 *  无 Shift 点未选 = 替换选集。返回挂起剔除的 id */
function resolveSelection(hitId: string, isShift: boolean): string | null {
  const { selectedIds } = getDocState()
  if (isShift) {
    if (selectedIds.includes(hitId)) return hitId
    docActions.selectIds([...selectedIds, hitId])
  } else if (!selectedIds.includes(hitId)) docActions.select(hitId)
  return null
}

interface Moving {
  /** 选集的根(画板整棵一起动,只有根参与吸附与外接框) */
  roots: SceneNode[]
  /** 根 + 全部后代:每帧都要平移的对象 */
  all: SceneNode[]
}

/** 拖出副本:克隆当前移动集(画板连后代),副本的根整体选中,返回副本 */
function duplicateMoving(source: Moving): Moving {
  const { made, rootIds } = cloneTrees(
    source.all,
    source.roots.map((n) => n.id),
    getDocState().nodes,
    { x: 0, y: 0 }
  )
  for (const node of made) docActions.dispatch({ type: 'add', node })
  docActions.selectIds(rootIds)
  return { roots: made.filter((n) => rootIds.includes(n.id)), all: made }
}

export function startNodeDrag(
  e: React.PointerEvent,
  hitId: string,
  start: Point,
  deps: MoveGestureDeps
): void {
  const pendingDeselectId = resolveSelection(hitId, e.shiftKey)
  const isDuplicate = e.altKey
  const collapseOnClick = !e.shiftKey && getDocState().selectedIds.length > 1
  // 锁定的节点(经图层面板选进选集的)不跟着动;选中画板时后代随它一起动
  let moving: Moving = movableSelection(getDocState().nodes, getDocState().selectedIds)
  if (moving.roots.length === 0) return
  const union = unionBox(moving.roots)
  let hasMoved = false
  let hasDuplicated = false
  trackPointer(
    e,
    (ev) => {
      const cur = deps.toDesign(ev)
      let dx = cur.x - start.x
      let dy = cur.y - start.y
      if (ev.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0
        else dx = 0
      }
      // 复制手势要等真正拖开才克隆,只点不拖不留副本
      if (isDuplicate && !hasDuplicated) {
        if (dx === 0 && dy === 0) return
        moving = duplicateMoving(moving)
        hasDuplicated = true
      }
      const movingIds = moving.all.map((n) => n.id)
      const raw = { x: union.x + dx, y: union.y + dy, width: union.width, height: union.height }
      let unionX = Math.round(raw.x)
      let unionY = Math.round(raw.y)
      let guides = NO_GUIDES
      let marks: GapMark[] = []
      const others = snapTargets(getDocState().nodes, movingIds)
      const threshold = SNAP_THRESHOLD_PX / deps.getZoom()
      let refMarks: GapMark[] = []
      let isSpacingSnapped = false
      if (!((ev.ctrlKey || ev.metaKey) && !isDuplicate)) {
        const s = snapMove(raw, others, threshold)
        guides = s.guides
        // 吸上的轴用精确值(中线对奇数宽可能出 .5),没吸上的轴用取整过的
        if (s.guides.v) unionX = s.x
        if (s.guides.h) unionY = s.y
        const sp = snapSpacing(
          { ...raw, x: s.guides.v ? s.x : raw.x, y: s.guides.h ? s.y : raw.y },
          others,
          threshold,
          { x: s.guides.v !== null, y: s.guides.h !== null }
        )
        if (sp.isSnapped.x) unionX = sp.x
        if (sp.isSnapped.y) unionY = sp.y
        refMarks = sp.refMarks
        isSpacingSnapped = sp.isSnapped.x || sp.isSnapped.y
      }
      const isModifierHeld = ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey
      if (isSpacingSnapped || isModifierHeld) {
        marks = gapMarks(
          { x: unionX, y: unionY, width: union.width, height: union.height },
          others,
          refMarks,
          true
        )
      }
      deps.setGuides(guides)
      deps.setGaps(marks)
      hasMoved = true
      const ddx = unionX - union.x
      const ddy = unionY - union.y
      for (const origin of moving.all) {
        docActions.dispatch({
          type: 'update',
          id: origin.id,
          patch: translatePatch(origin, ddx, ddy)
        })
      }
    },
    () => {
      deps.setGuides(NO_GUIDES)
      deps.setGaps([])
      // 松手按中心点重新认爹:拖进/拖出画板即换归属
      if (hasMoved) {
        const rootIds = moving.roots.map((n) => n.id)
        for (const { id, parentId } of reparentPatches(getDocState().nodes, rootIds)) {
          docActions.dispatch({ type: 'update', id, patch: { parentId } })
        }
      }
      // 单击才落实 Shift 剔除;拖动过就不剔(Shift+拖已选对象 = 整组轴锁移动)
      if (!hasMoved && pendingDeselectId) docActions.toggleSelect(pendingDeselectId)
      else if (!hasMoved && collapseOnClick) docActions.select(hitId)
    },
    isDuplicate ? 'copy' : 'move'
  )
}
