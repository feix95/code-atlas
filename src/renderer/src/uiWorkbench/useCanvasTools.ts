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
  radiusFromLocal,
  rectCenter,
  rectFromDrag,
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
import type { LineNode } from '@shared/uiWorkbench/line'
import { hitTopmost, nodeOverlapsBox } from '@shared/uiWorkbench/scene'
import { snapMove, snapTargets, type SnapBox, type SnapGuides } from '@shared/uiWorkbench/snap'
import type { GapMark } from '@shared/uiWorkbench/spacing'
import type { ScaleHandle } from '@shared/uiWorkbench/groupScale'
import { docActions, getDocState, selectedLine, selectedRect } from './documentStore'
import { cornerResizeCursor, edgeResizeCursor } from './cursors'
import { isEditableTarget } from './isEditableTarget'
import { startLineDraw, startLineEndpointDrag, type LineGestureDeps } from './lineGestures'
import { startGroupScaleDrag } from './groupScaleGesture'
import { SNAP_THRESHOLD_PX, startNodeDrag, type MoveGestureDeps } from './moveGesture'
import { getNewRectAppearance } from './newRectDefaultsStore'
import { releaseEditableFocus, trackPointer } from './trackPointer'
import { useDocShortcuts } from './useDocShortcuts'
import type { CanvasViewportApi } from './useCanvasViewport'

export type CanvasTool = 'select' | 'rect' | 'line'
/** 正在进行的选中手势(覆盖层用来保持旋钮可见) */
export type GestureKind = 'radius' | 'rotate' | null

/** Shift 拖圆角柄的吸附步长:4pt 网格约定 */
const RADIUS_SNAP_STEP = 4
/** 直线点选容差(屏幕像素):线细,不放宽就点不中;除以 zoom 换成设计单位 */
const LINE_HIT_TOLERANCE_PX = 6

export interface CanvasToolsApi {
  tool: CanvasTool
  setTool: (tool: CanvasTool) => void
  activeGesture: GestureKind
  /** 移动拖动中的对齐引导线(设计单位),覆盖层照着画线 */
  guides: SnapGuides
  /** 移动拖动中的间距标注(等间距吸附 / 按住修饰键时的邻居距离),覆盖层照着画 */
  gaps: GapMark[]
  /** 框选手势中的选框(设计单位),覆盖层照着画虚线框 */
  marquee: RectBox | null
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  startResizeDrag: (e: React.PointerEvent, corner: CornerIndex) => void
  startEdgeDrag: (e: React.PointerEvent, edge: EdgeName) => void
  startRadiusDrag: (e: React.PointerEvent, corner: CornerIndex) => void
  startRotateDrag: (e: React.PointerEvent) => void
  startEndpointDrag: (e: React.PointerEvent, which: 'start' | 'end') => void
  startGroupScale: (e: React.PointerEvent, handle: ScaleHandle) => void
}
export function useCanvasTools(viewport: CanvasViewportApi, board: ArtboardSize): CanvasToolsApi {
  const [tool, setTool] = useState<CanvasTool>('select')
  const [activeGesture, setActiveGesture] = useState<GestureKind>(null)
  const [guides, setGuides] = useState<SnapGuides>({ v: null, h: null })
  const [gaps, setGaps] = useState<GapMark[]>([])
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
    if (toolRef.current === 'line') {
      startLineDraw(e, lineGestureDeps())
      return
    }
    if (toolRef.current === 'rect') {
      // trackPointer 拿不到 win 会直接 return:外层批次先别开,免得挂起不结算
      if (!e.currentTarget.ownerDocument.defaultView) return
      // 画矩形是一笔:add(落点 1×1)+ 拖动 update + 松手结算(没拖动则回收),外层批次包住;
      // 中途任何一步抛异常都必须把外层批次结掉再抛出,否则批次挂起、撤销永久失灵
      docActions.beginBatch()
      try {
        const prevSelectedIds = getDocState().selectedIds
        // 新矩形吃「新矩形默认外观」;起手 1×1 会把圆角钳成 0,所以拖动每帧都重新带上默认圆角
        const look = getNewRectAppearance()
        const node = createRect(getDocState().nodes, { ...start, width: 1, height: 1 }, look)
        docActions.dispatch({ type: 'add', node })
        docActions.select(node.id)
        trackPointer(
          e,
          (ev) =>
            docActions.dispatch({
              type: 'update',
              id: node.id,
              patch: {
                ...rectFromDrag(start, toDesign(ev), {
                  isSquare: ev.shiftKey,
                  isFromCenter: ev.altKey
                }),
                radii: look.radii,
                styleId: look.styleId
              }
            }),
          () => {
            try {
              const fresh = getDocState().nodes.find((n) => n.id === node.id)
              // 只点没拖(PS 规矩):松手时仍是落点 1×1 = 没有有效拖动,直接回收——
              // 与 add 同批抵消,净零不入账,也不会冒出幽灵矩形;
              // 顺手还回按下前的选集——单击=什么都没发生,连选中态都不动
              if (fresh?.type === 'rect' && fresh.width === 1 && fresh.height === 1) {
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
    const hit = hitTopmost(getDocState().nodes, start, LINE_HIT_TOLERANCE_PX / viewRef.current.zoom)
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
            .nodes.filter((n) => nodeOverlapsBox(n, box))
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
    startNodeDrag(e, hit.id, start, moveGestureDeps())
  }

  function startResizeDrag(e: React.PointerEvent, corner: CornerIndex): void {
    const node = selectedRect(getDocState())
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
    const node = selectedRect(getDocState())
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
    const node = selectedRect(getDocState())
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
    const node = selectedRect(getDocState())
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

  /** 调整手势松手后:绘制工具(矩形/直线)自动回落到移动工具(已是移动时幂等) */
  function fallbackToSelect(): void {
    if (toolRef.current !== 'select') setTool('select')
  }

  /** 点吸附:拖动中的端点当零尺寸盒,向其他对象 + 画板 + extra 的 起边/中线/终边 靠拢 */
  function snapPoint(
    point: Point,
    excludeIds: readonly string[],
    extra: readonly SnapBox[]
  ): { point: Point; guides: SnapGuides } {
    const s = snapMove(
      { x: point.x, y: point.y, width: 0, height: 0 },
      [
        ...snapTargets(getDocState().nodes, excludeIds),
        { x: 0, y: 0, width: boardRef.current.width, height: boardRef.current.height },
        ...extra
      ],
      SNAP_THRESHOLD_PX / viewRef.current.zoom
    )
    return { point: { x: s.x, y: s.y }, guides: s.guides }
  }

  function moveGestureDeps(): MoveGestureDeps {
    return {
      toDesign,
      getZoom: () => viewRef.current.zoom,
      getBoard: () => boardRef.current,
      setGuides,
      setGaps
    }
  }

  function lineGestureDeps(): LineGestureDeps {
    return { toDesign, onDone: fallbackToSelect, snapPoint, setGuides }
  }

  function startEndpointDrag(e: React.PointerEvent, which: 'start' | 'end'): void {
    const line: LineNode | null = selectedLine(getDocState())
    if (!line || e.button !== 0) return
    startLineEndpointDrag(e, line, which, lineGestureDeps())
  }

  const startGroupScale = (e: React.PointerEvent, handle: ScaleHandle): void =>
    startGroupScaleDrag(e, handle, toDesign)

  useToolKeys(viewport, setTool)
  useDocShortcuts(viewport)

  return {
    tool,
    setTool,
    activeGesture,
    guides,
    gaps,
    marquee,
    onPointerDown,
    startResizeDrag,
    startEdgeDrag,
    startRadiusDrag,
    startRotateDrag,
    startEndpointDrag,
    startGroupScale
  }
}

/** 单键快捷键:鼠标在画布上且焦点不在输入框时生效——Esc 取消选中,V 移动,R 矩形,L 直线;
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
      else if (e.code === 'KeyL') setTool('line')
      else return
      e.preventDefault()
    }
    win.addEventListener('keydown', onKey, true)
    return () => win.removeEventListener('keydown', onKey, true)
  }, [viewportRef, isHoveredRef, setTool])
}
