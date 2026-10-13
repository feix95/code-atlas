// 画布工具与节点手势:V 选择/移动/框选、R 拖出矩形(Shift 正方形、Alt 从中心、只点不拖不出形);
// 画图手势松手即回弹选择工具(Figma 式):要再画就再点一次矩形工具,杜绝「点选变新建」;
// 调整手势(角点缩放/圆角点/旋转旋钮)松手同样回落——「画」归画,「调」归调。
// 属性面板改数值不触发回落。
// 选择工具(Figma 式):空白处拖动 = 框选(扫到即中,Shift 并入),只点没拖 = 清选;
// Shift+点击 = 加减选;拖任一选中节点 = 整组移动,对齐吸附按选集联合外接框算。
// 单选后:四角小圆点 = 圆角(默认四角同调,按住 Ctrl 只调该角);
// 顶边外侧的点状旋钮 = 绕中心旋转(Shift 吸附 15°)。拖出的坐标取整吸附。
// 全部修改经 docActions.dispatch 走 NodeAction,与撤销 / AI 日后共用同一条命令通路。
import { useEffect, useRef, useState } from 'react'
import {
  angleDeg,
  hitTopmost,
  radiusFromLocal,
  rectCenter,
  rectFromDrag,
  rectOverlapsBox,
  resizeRect,
  resizeRectEdge,
  snapAngle,
  snapValue,
  toLocal,
  type Point,
  type RectBox
} from '@shared/uiWorkbench/geometry'
import type { ArtboardSize } from '@shared/uiWorkbench/artboard'
import {
  createRect,
  maxCornerRadius,
  normalizeRotation,
  withCornerRadius,
  type CornerIndex,
  type EdgeName
} from '@shared/uiWorkbench/node'
import { snapMove, snapTargets, type SnapGuides } from '@shared/uiWorkbench/snap'
import { docActions, getDocState, selectedNode } from './documentStore'
import { cornerResizeCursor, edgeResizeCursor } from './cursors'
import { isEditableTarget } from './isEditableTarget'
import { useDocShortcuts } from './useDocShortcuts'
import type { CanvasViewportApi } from './useCanvasViewport'

export type CanvasTool = 'select' | 'rect'
/** 正在进行的选中手势(覆盖层用来保持旋钮可见) */
export type GestureKind = 'radius' | 'rotate' | null

/** Shift 拖圆角柄的吸附步长:4pt 网格约定 */
const RADIUS_SNAP_STEP = 4
/** 对齐吸附的命中距离(屏幕像素):除以 zoom 换成设计单位,放得越大吸得越「松」 */
const SNAP_THRESHOLD_PX = 5

export interface CanvasToolsApi {
  tool: CanvasTool
  setTool: (tool: CanvasTool) => void
  activeGesture: GestureKind
  /** 移动拖动中的对齐引导线(设计单位),覆盖层照着画线 */
  guides: SnapGuides
  /** 框选手势中的选框(设计单位),覆盖层照着画虚线框 */
  marquee: RectBox | null
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  startResizeDrag: (e: React.PointerEvent, corner: CornerIndex) => void
  startEdgeDrag: (e: React.PointerEvent, edge: EdgeName) => void
  startRadiusDrag: (e: React.PointerEvent, corner: CornerIndex) => void
  startRotateDrag: (e: React.PointerEvent) => void
}

/** 画布手势的 pointerdown 都 preventDefault(防选中文字),浏览器因此不会转移焦点:
 *  之前停在面板输入框/下拉上的焦点会原地留着,isEditableTarget 随即把 Delete、V/R、方向键
 *  和 Ctrl+Z 全挡成死键(症状:重启后能用,碰过面板控件再点画布就失灵)。手势一开始主动释放 */
function releaseEditableFocus(doc: Document): void {
  const active = doc.activeElement
  if (isEditableTarget(active)) (active as HTMLElement).blur()
}

/** 手势换算只依赖这几样:指针位置 + 修饰键状态(PointerEvent 与合成重放共用) */
type DragEventLike = Pick<
  PointerEvent,
  'clientX' | 'clientY' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'
>

/** 拖动期间挂 window 级监听:指针飞出元素手势也不断;结束时收掉。
 *  修饰键按下/松开会在最后一次指针位置原地重算——按 Shift 立即吸附、松开落回原值(PS 式);
 *  dragCursor 把手势光标钉在文档根上,指针悬到别处也不跳回默认;
 *  setPointerCapture + blur 兜底:窗口外松手/失焦也能收尾,光标不会被钉死 */
function trackPointer(
  down: React.PointerEvent,
  onMove: (e: DragEventLike) => void,
  onEnd: () => void,
  dragCursor?: string
): void {
  releaseEditableFocus(down.currentTarget.ownerDocument)
  const target = down.currentTarget
  const win = target.ownerDocument.defaultView
  if (!win) return
  const root = win.document.documentElement
  const prevCursor = root.style.cursor
  if (dragCursor) root.style.cursor = dragCursor
  let last: DragEventLike | null = null
  const move = (e: PointerEvent): void => {
    last = e
    onMove(e)
  }
  const modifier = (e: KeyboardEvent): void => {
    if (!last || (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta'))
      return
    onMove({
      clientX: last.clientX,
      clientY: last.clientY,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey
    })
  }
  const end = (): void => {
    win.removeEventListener('pointermove', move)
    win.removeEventListener('keydown', modifier, true)
    win.removeEventListener('keyup', modifier, true)
    win.removeEventListener('pointerup', end)
    win.removeEventListener('pointercancel', end)
    win.removeEventListener('blur', end)
    if (dragCursor) root.style.cursor = prevCursor
    try {
      onEnd()
    } finally {
      docActions.endBatch()
    }
  }
  // 先捕获再开批:setPointerCapture 一旦抛异常,批次就不会被留下挂起;
  // 抛出时顺手还原手势光标,不留钉死的 cursor
  try {
    target.setPointerCapture(down.pointerId)
  } catch (err) {
    if (dragCursor) root.style.cursor = prevCursor
    throw err
  }
  docActions.beginBatch()
  win.addEventListener('pointermove', move)
  win.addEventListener('keydown', modifier, true)
  win.addEventListener('keyup', modifier, true)
  win.addEventListener('pointerup', end)
  win.addEventListener('pointercancel', end)
  win.addEventListener('blur', end)
}

export function useCanvasTools(viewport: CanvasViewportApi, board: ArtboardSize): CanvasToolsApi {
  const [tool, setTool] = useState<CanvasTool>('select')
  const [activeGesture, setActiveGesture] = useState<GestureKind>(null)
  const [guides, setGuides] = useState<SnapGuides>({ v: null, h: null })
  const [marquee, setMarquee] = useState<RectBox | null>(null)
  const viewRef = useRef(viewport.view)
  const toolRef = useRef(tool)
  const boardRef = useRef(board)
  useEffect(() => {
    viewRef.current = viewport.view
    toolRef.current = tool
    boardRef.current = board
  })
  const toDesign = (e: { clientX: number; clientY: number }): Point => {
    const el = viewport.viewportRef.current
    const v = viewRef.current
    const rect = el?.getBoundingClientRect()
    return {
      x: (e.clientX - (rect?.left ?? 0) - v.panX) / v.zoom,
      y: (e.clientY - (rect?.top ?? 0) - v.panY) / v.zoom
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    releaseEditableFocus(e.currentTarget.ownerDocument)
    const start = toDesign(e)
    if (toolRef.current === 'rect') {
      // trackPointer 拿不到 win 会直接 return:外层批次先别开,免得挂起不结算
      if (!e.currentTarget.ownerDocument.defaultView) return
      // 画矩形是一笔:add(落点 1×1)+ 拖动 update + 松手结算(没拖动则回收),外层批次包住;
      // 中途任何一步抛异常都必须把外层批次结掉再抛出,否则批次挂起、撤销永久失灵
      docActions.beginBatch()
      try {
        const prevSelectedIds = getDocState().selectedIds
        const node = createRect(getDocState().nodes, { ...start, width: 1, height: 1 })
        docActions.dispatch({ type: 'add', node })
        docActions.select(node.id)
        trackPointer(
          e,
          (ev) =>
            docActions.dispatch({
              type: 'update',
              id: node.id,
              patch: rectFromDrag(start, toDesign(ev), {
                isSquare: ev.shiftKey,
                isFromCenter: ev.altKey
              })
            }),
          () => {
            try {
              const fresh = getDocState().nodes.find((n) => n.id === node.id)
              // 只点没拖(PS 规矩):松手时仍是落点 1×1 = 没有有效拖动,直接回收——
              // 与 add 同批抵消,净零不入账,也不会冒出幽灵矩形;
              // 顺手还回按下前的选集——单击=什么都没发生,连选中态都不动
              if (fresh && fresh.width === 1 && fresh.height === 1) {
                docActions.dispatch({ type: 'remove', id: node.id })
                docActions.selectIds(prevSelectedIds)
              }
            } finally {
              // 最外层批次在此结算:整个「画一个矩形」= 一步撤销
              docActions.endBatch()
            }
            // 画完自动回弹选择工具(Figma 式):新矩形保持选中,直接就能拖/调
            setTool('select')
          },
          'crosshair'
        )
      } catch (err) {
        docActions.endBatch()
        throw err
      }
      return
    }
    const hit = hitTopmost(getDocState().nodes, start)
    if (!hit) {
      // 空白起拖 = 框选(Figma/PS 同款手势,折在选择工具里):扫到谁选谁,命中高亮实时刷;
      // Shift = 并入现有选集;只点没拖 = 单击空白清选(Shift+单击空白不动选集)
      const additive = e.shiftKey
      const base = additive ? [...getDocState().selectedIds] : []
      let moved = false
      trackPointer(
        e,
        (ev) => {
          const cur = toDesign(ev)
          const box: RectBox = {
            x: Math.min(start.x, cur.x),
            y: Math.min(start.y, cur.y),
            width: Math.abs(cur.x - start.x),
            height: Math.abs(cur.y - start.y)
          }
          if (box.width > 0 || box.height > 0) moved = true
          setMarquee(box)
          const hits = getDocState()
            .nodes.filter((n) => rectOverlapsBox(n, box))
            .map((n) => n.id)
          docActions.selectIds([...base, ...hits.filter((id) => !base.includes(id))])
        },
        () => {
          setMarquee(null)
          if (!moved && !additive) docActions.selectIds([])
        }
      )
      return
    }
    // 命中节点:先定选集再移动。Shift 点已选节点 = 挂起剔除(单击才剔,拖动仍带它走,即 Figma 的
    // Shift+拖动 = 整组轴锁移动);Shift 点未选 = 并入;无 Shift 点未选 = 替换选集
    let pendingDeselectId: string | null = null
    if (e.shiftKey) {
      if (getDocState().selectedIds.includes(hit.id)) pendingDeselectId = hit.id
      else docActions.selectIds([...getDocState().selectedIds, hit.id])
    } else if (!getDocState().selectedIds.includes(hit.id)) {
      docActions.select(hit.id)
    }
    // 整组移动:按下瞬间的选集即移动集,联合外接框当「被拖矩形」进吸附;
    // 多选时普通单击某个已选成员 = 收拢到只选它(Figma 式),拖动则整组动
    const movingIds = [...getDocState().selectedIds]
    const collapseOnClick = !e.shiftKey && movingIds.length > 1
    const moving = getDocState().nodes.filter((n) => movingIds.includes(n.id))
    const origins = new Map(moving.map((n) => [n.id, { x: n.x, y: n.y }]))
    const union = {
      x: Math.min(...moving.map((n) => n.x)),
      y: Math.min(...moving.map((n) => n.y)),
      width: Math.max(...moving.map((n) => n.x + n.width)) - Math.min(...moving.map((n) => n.x)),
      height: Math.max(...moving.map((n) => n.y + n.height)) - Math.min(...moving.map((n) => n.y))
    }
    let moved = false
    trackPointer(
      e,
      (ev) => {
        const cur = toDesign(ev)
        let dx = cur.x - start.x
        let dy = cur.y - start.y
        // Shift 轴锁:位移主方向走直线,另一轴钉死(Figma 式)
        if (ev.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0
          else dx = 0
        }
        let unionX = Math.round(union.x + dx)
        let unionY = Math.round(union.y + dy)
        let next: SnapGuides = { v: null, h: null }
        // Ctrl/Cmd 按住 = 临时禁用吸附(Figma 式);修饰键中途变化由 trackPointer 原地重放本函数
        if (!ev.ctrlKey && !ev.metaKey) {
          const s = snapMove(
            { x: union.x + dx, y: union.y + dy, width: union.width, height: union.height },
            [
              ...snapTargets(getDocState().nodes, movingIds),
              { x: 0, y: 0, width: boardRef.current.width, height: boardRef.current.height }
            ],
            SNAP_THRESHOLD_PX / viewRef.current.zoom
          )
          next = s.guides
          // 吸上的轴用精确值(中线对奇数宽可能出 .5),没吸上的轴用上面取整过的
          if (s.guides.v) unionX = s.x
          if (s.guides.h) unionY = s.y
        }
        setGuides(next)
        moved = true
        const ddx = unionX - union.x
        const ddy = unionY - union.y
        for (const id of movingIds) {
          const o = origins.get(id)
          if (o) {
            docActions.dispatch({ type: 'update', id, patch: { x: o.x + ddx, y: o.y + ddy } })
          }
        }
      },
      () => {
        setGuides({ v: null, h: null })
        // 单击才落实 Shift 剔除;拖动过就不剔(Figma:Shift+拖已选对象 = 整组轴锁移动)
        if (!moved && pendingDeselectId) docActions.toggleSelect(pendingDeselectId)
        else if (!moved && collapseOnClick) docActions.select(hit.id)
      },
      'move'
    )
  }

  function startResizeDrag(e: React.PointerEvent, corner: CornerIndex): void {
    const node = selectedNode(getDocState())
    if (!node || e.button !== 0) return
    trackPointer(
      e,
      (ev) =>
        docActions.dispatch({
          type: 'update',
          id: node.id,
          patch: resizeRect(node, corner, toLocal(node, toDesign(ev)), ev.shiftKey)
        }),
      fallbackToSelect,
      cornerResizeCursor(node.rotation, corner)
    )
  }

  /** 边中点拖拽:只动被拖那条边,对边钉死;Shift 吸 4pt 网格(同圆角柄约定) */
  function startEdgeDrag(e: React.PointerEvent, edge: EdgeName): void {
    const node = selectedNode(getDocState())
    if (!node || e.button !== 0) return
    trackPointer(
      e,
      (ev) =>
        docActions.dispatch({
          type: 'update',
          id: node.id,
          patch: resizeRectEdge(
            node,
            edge,
            toLocal(node, toDesign(ev)),
            ev.shiftKey ? RADIUS_SNAP_STEP : 0
          )
        }),
      fallbackToSelect,
      edgeResizeCursor(node.rotation, edge)
    )
  }

  function startRadiusDrag(e: React.PointerEvent, corner: CornerIndex): void {
    const node = selectedNode(getDocState())
    if (!node || e.button !== 0) return
    setActiveGesture('radius')
    const cap = maxCornerRadius(node.width, node.height)
    trackPointer(
      e,
      (ev) => {
        let radius = radiusFromLocal(node, corner, toLocal(node, toDesign(ev)))
        if (ev.shiftKey) radius = Math.min(cap, snapValue(radius, RADIUS_SNAP_STEP))
        docActions.dispatch({
          type: 'update',
          id: node.id,
          patch: {
            radii: withCornerRadius(node.radii, ev.ctrlKey || ev.metaKey ? corner : 'all', radius)
          }
        })
      },
      () => {
        setActiveGesture(null)
        fallbackToSelect()
      },
      cornerResizeCursor(node.rotation, corner)
    )
  }

  function startRotateDrag(e: React.PointerEvent): void {
    const node = selectedNode(getDocState())
    if (!node || e.button !== 0) return
    const center = rectCenter(node)
    const base = angleDeg(center, toDesign(e))
    setActiveGesture('rotate')
    trackPointer(
      e,
      (ev) => {
        const raw = node.rotation + angleDeg(center, toDesign(ev)) - base
        docActions.dispatch({
          type: 'update',
          id: node.id,
          patch: { rotation: normalizeRotation(ev.shiftKey ? snapAngle(raw, 15) : raw) }
        })
      },
      () => {
        setActiveGesture(null)
        fallbackToSelect()
      },
      'grabbing'
    )
  }

  /** 调整手势松手后:矩形工具自动回落到移动工具(已是移动时幂等) */
  function fallbackToSelect(): void {
    if (toolRef.current === 'rect') setTool('select')
  }

  useToolKeys(viewport, setTool)
  useDocShortcuts(viewport)

  return {
    tool,
    setTool,
    activeGesture,
    guides,
    marquee,
    onPointerDown,
    startResizeDrag,
    startEdgeDrag,
    startRadiusDrag,
    startRotateDrag
  }
}

/** 单键快捷键:鼠标在画布上且焦点不在输入框时生效——Esc 取消选中,V 移动,R 矩形;
 *  Delete 不在这层:它是文档级操作,归 useDocShortcuts(指针停在面板上也要删得掉) */
function useToolKeys(viewport: CanvasViewportApi, setTool: (tool: CanvasTool) => void): void {
  const { viewportRef, isHoveredRef } = viewport
  useEffect(() => {
    const win = viewportRef.current?.ownerDocument.defaultView
    if (!win) return
    const onKey = (e: KeyboardEvent): void => {
      if (!isHoveredRef.current || isEditableTarget(e.target)) return
      if (e.key === 'Escape') {
        docActions.select(null)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'KeyV') setTool('select')
      else if (e.code === 'KeyR') setTool('rect')
      else return
      e.preventDefault()
    }
    win.addEventListener('keydown', onKey, true)
    return () => win.removeEventListener('keydown', onKey, true)
  }, [viewportRef, isHoveredRef, setTool])
}
