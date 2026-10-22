// 页签拖拽会话(手搓 pointer 引擎):按下 → 过阈值开拖 → 跟手/让位/跨窗 → 松手交账或取消飞回。
// 不吃 HTML5 DnD —— 原生幻影带黑框、没有让位动画。
import { useRef, useState } from 'react'
import type { AuxWindowRect } from '@shared/types'
import type { TabBarTab } from './components/TabBar'
import type { PaneDropMark, PaneGroup, PaneTab } from './paneTabs'
import { commitDropZone } from './tabDragCommit'
import { probeCrossZone, probeLocalZone } from './tabDragHitTest'
import { finishDropSettle } from './tabDragSettle'
import {
  CHIP_FADE_MS,
  DRAG_START_PX,
  type CrossTarget,
  type DragZone,
  type SourceRect,
  type TabDragSession,
  type TabDragState
} from './tabDragTypes'
import {
  snapshotDragWindows,
  type BodySnap,
  type DragWindowRef,
  type StripSnap,
  type WindowSnap
} from './tabDragWindows'
import { useChipPhase } from './useChipPhase'

export function useTabDragSession(deps: {
  groups: PaneGroup[]
  visibleOfGroup: (g: PaneGroup | null) => PaneTab[]
  moveTab: (
    id: string,
    toGroup: 'sibling' | null,
    atIndex: number | null,
    splitSide?: 'left' | 'right'
  ) => void
  onMoveTabToHostAt: (
    id: string,
    host: string,
    groupId: string | null,
    atIndex: number | null
  ) => void
  onTabDragEnd: (id: string) => void
  setDropMark: React.Dispatch<React.SetStateAction<PaneDropMark | null>>
  /** 本页签带所在窗的登记名(主窗 'main' / 子窗 'aux-N'):跨窗判定要认自己是谁 */
  host: string
  /** 全部可参与落点的窗(主窗 + 各子窗):拖拽开始时量快照 */
  dragWindows: readonly DragWindowRef[]
  /** 第一组分屏列占内容宽的比例:单组拆栏时推新条带的落点 */
  paneSplit: number
}): TabDragSession {
  const { groups, visibleOfGroup, moveTab, onMoveTabToHostAt, onTabDragEnd, setDropMark } = deps
  const { host, dragWindows, paneSplit } = deps

  const [drag, setDrag] = useState<TabDragState | null>(null)
  // 落点缝开在哪条带、第几个空位(index 按「剔除被拖签」后的可见序数)
  const [gap, setGap] = useState<{ groupId: string; index: number } | null>(null)
  // 跨窗落点:目标窗局部坐标 + 插入线/正文亮边的几何(渲染时 Portal 进目标窗)
  const [cross, setCross] = useState<CrossTarget | null>(null)
  const chipRef = useRef<HTMLDivElement>(null)
  useChipPhase(drag, setDrag, chipRef)

  /** 页签 pointerdown 入场:先记起点,位移够阈值才升级成拖拽会话。
      监听挂 window(不捕获也收得到全部指针事件)—— 捕获得等确认开拖才上,
      不然 click 会被路由回页签,页签里的 × 钮整个失灵(亲历坑,别往回改)。
      渲染域隔离(页签独立窗口):Portal 渲染进子窗的页签住在另一个 document,
      监听/查询/视口量一律走 el.ownerDocument —— 挂全局 window 上子窗的拖拽全聋 */
  function beginTabDrag(e: React.PointerEvent<HTMLDivElement>, t: TabBarTab): void {
    if (e.button !== 0 || drag) return
    const el = e.currentTarget
    const doc = el.ownerDocument
    const view = doc.defaultView ?? window
    const rect: SourceRect = (() => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, width: r.width, height: r.height }
    })()
    const grabDx = e.clientX - rect.left
    const grabDy = e.clientY - rect.top
    const srcGroupId = groups.find((g) => g.tabs.some((x) => x.id === t.id))?.id ?? null
    let started = false
    let captured = false
    // 全部窗的局部几何 + 屏幕矩形:按下就量一次(IPC 很快,拖拽不等它;
    // 没回来前只认本窗,回来再补全目标窗)
    let windowSnaps: WindowSnap[] = []
    let snaps: StripSnap[] = []
    let bodies: BodySnap[] = []
    let zone: DragZone = { type: 'none' }

    const refreshSnaps = (rects: readonly AuxWindowRect[]): void => {
      windowSnaps = snapshotDragWindows(dragWindows, rects, host)
      const own = windowSnaps.find((w) => w.host === host)
      snaps = own?.strips ?? []
      bodies = own?.bodies ?? []
    }
    refreshSnaps([])
    void window.atlas
      .auxWindowRects()
      .then((rects) => {
        // 拖拽已开始:只补目标窗。源窗快照必须保持开拖那一刻 ——
        // 活序滑动会逐帧改 DOM 坐标,这时回读会把邻居的位移当成原位
        if (!started) {
          refreshSnaps(rects)
          return
        }
        windowSnaps = snapshotDragWindows(dragWindows, rects, host).map((w) =>
          w.host === host ? { ...w, strips: snaps, bodies } : w
        )
      })
      .catch((err: unknown) => {
        window.atlas.reportRendererError(`跨窗拖拽取窗口矩形失败: ${String(err)}`)
      })

    // 吞掉拖完那次 click:指针捕获把所有事件都路由给原页签,松手会补发 click ——
    // 不吞的话拖完还顺手激活了它(VS Code 同款处理)
    const swallowClick = (): void => {
      const swallow = (ev: Event): void => {
        ev.preventDefault()
        ev.stopPropagation()
      }
      el.addEventListener('click', swallow, { capture: true, once: true })
    }

    const removeListeners = (): void => {
      view.removeEventListener('pointermove', move)
      view.removeEventListener('pointerup', up)
      view.removeEventListener('pointercancel', cancel)
      view.removeEventListener('keydown', onKey)
      view.removeEventListener('blur', cancel)
      doc.removeEventListener('visibilitychange', onVisChange)
      // 先摘再放:releasePointerCapture 会异步补发 lostpointercapture,
      // 监听还活着的话 cancel 会二次进场误杀下一趟拖拽会话
      el.removeEventListener('lostpointercapture', cancel)
      if (captured && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      doc.body.classList.remove('is-tab-dragging')
    }

    const endSession = (): void => {
      setDrag(null)
      setGap(null)
      setDropMark(null)
      setCross(null)
    }

    /** 跨窗落账后把目标窗带到前台(Chrome 同款);主窗也走主进程 focus,renderer 的 window.focus() 不保证生效 */
    const commitZone = (z: DragZone): void => {
      commitDropZone(z, {
        srcGroupId,
        tabId: t.id,
        groups,
        visibleOfGroup,
        moveTab,
        onMoveTabToHostAt
      })
    }

    // 松手/取消的统一收尾:芯片沉降飞矩形,落地后才交账 + 收场
    const finishWithSettle = (z: DragZone, doCommit: boolean): void => {
      finishDropSettle({
        zone: z,
        doCommit,
        srcGroupId,
        tabId: t.id,
        rect,
        paneSplit,
        snaps,
        bodies,
        view,
        commit: commitZone,
        endSession,
        setDrag,
        setDropMark
      })
    }

    const move = (ev: PointerEvent): void => {
      // 失焦期间窗外松手会吃掉 pointerup(事件转给别家窗):按键早没了
      // 却还在收 move = 松手被吞了,按取消关闭 —— Alt+Tab 切走/截图工具抢焦点同病
      if ((ev.buttons & 1) === 0) {
        cancel()
        return
      }
      const cx = ev.clientX
      const cy = ev.clientY
      if (!started) {
        if (Math.abs(cx - e.clientX) + Math.abs(cy - e.clientY) < DRAG_START_PX) return
        started = true
        // 此刻才捕获:窗外坐标还能继续报(拖出窗拆出新窗指望它),
        // 而此前 × 钮/右键的 click 走正常派发,不受影响
        el.setPointerCapture(ev.pointerId)
        captured = true
        doc.body.classList.add('is-tab-dragging')
        // 主动关闭:按住没动的那 300ms 里提示可能已经合法亮过,捕获一上 mouseout 全回退到源签
        // (relatedTarget 还在宿内→tooltip 永远收不到「离开」),不喊一声它就冻在屏上陪完整个拖拽
        doc.dispatchEvent(new CustomEvent('atlas:tab-drag-start'))
        view.addEventListener('keydown', onKey)
        // 几何快照在按下时就量好了(见 refreshSnaps);让位动画一开 DOM 逐帧在变,不能逐帧回读
        const ownSnap = snaps.find((s) => s.groupId === srcGroupId)
        setDrag({
          id: t.id,
          icon: t.icon,
          name: t.name,
          srcLeft: rect.left,
          srcTop: rect.top,
          width: rect.width,
          height: rect.height,
          compactW: rect.width, // born 阶段先顶着,born→enter 时量出真紧凑宽高
          compactH: rect.height,
          grabDx,
          grabDy,
          x: cx,
          y: cy,
          slideMinL: ownSnap?.mids[0]?.left ?? rect.left,
          slideMaxR: ownSnap?.mids[ownSnap.mids.length - 1]?.right ?? rect.right,
          phase: 'born',
          leaving: false,
          willDetach: false
        })
        return
      }

      const outOfWindow = cx < 0 || cy < 0 || cx >= view.innerWidth || cy >= view.innerHeight
      setDrag((d) => (d ? { ...d, x: cx, y: cy, willDetach: false } : d))
      const chipWidth = chipRef.current?.getBoundingClientRect().width ?? rect.width

      if (!outOfWindow) {
        setCross(null)
        const probe = probeLocalZone({
          cx,
          cy,
          snaps,
          bodies,
          groups,
          srcGroupId,
          tabId: t.id,
          rect,
          grabDx,
          chipWidth
        })
        zone = probe.zone
        setGap((prev) =>
          prev && probe.gap && prev.groupId === probe.gap.groupId && prev.index === probe.gap.index
            ? prev
            : probe.gap
        )
        setDropMark((prev) => {
          if (!prev && !probe.dropMark) return prev
          if (
            prev &&
            probe.dropMark &&
            prev.groupId === probe.dropMark.groupId &&
            prev.zone === probe.dropMark.zone
          )
            return prev
          return probe.dropMark
        })
        return
      }

      // ── 跨窗:按屏幕坐标找目标窗,再换算成目标窗局部坐标套同一套判定 ──
      setGap(null)
      setDropMark(null)
      const probe = probeCrossZone({
        screenX: ev.screenX,
        screenY: ev.screenY,
        windowSnaps,
        host,
        grabDx,
        chipWidth
      })
      zone = probe.zone
      setCross(probe.cross)
      if (probe.zone.type === 'outside') setDrag((d) => (d ? { ...d, willDetach: true } : d))
    }

    const up = (): void => {
      removeListeners()
      if (!started) return // 普通点按:click 照常激活
      swallowClick()
      const z = zone
      if (z.type === 'outside') {
        // 拖出窗拆出新窗:不走沉降(窗外没落点),原地淡出交账
        onTabDragEnd(t.id)
        setGap(null)
        setDropMark(null)
        setCross(null)
        setDrag((d) => (d ? { ...d, leaving: true } : d))
        // 淡出计时按 id 守卫:淡出内开新拖,别误杀新会话的芯片
        view.setTimeout(
          () => setDrag((d) => (d && d.id === t.id && d.leaving ? null : d)),
          CHIP_FADE_MS
        )
        return
      }
      if (z.type === 'host-strip' || z.type === 'host-body') {
        // 目标窗在拖拽途中被关:数据不动,按取消收场(别把签塞进死窗)
        const alive = dragWindows.some((w) => w.host === z.host && !w.win.closed)
        if (!alive) {
          setCross(null)
          finishWithSettle({ type: 'none' }, false)
          return
        }
        // 跨窗落账:目标窗不在本 React Portal 里长沉降动画,交账后原地淡出
        commitZone(z)
        setGap(null)
        setDropMark(null)
        setCross(null)
        setDrag((d) => (d ? { ...d, leaving: true } : d))
        view.setTimeout(
          () => setDrag((d) => (d && d.id === t.id && d.leaving ? null : d)),
          CHIP_FADE_MS
        )
        return
      }
      finishWithSettle(z, z.type !== 'none')
    }

    const cancel = (): void => {
      const wasStarted = started
      removeListeners()
      if (!wasStarted) return
      swallowClick()
      // 取消 = 飞回源位,不交账(Esc / 系统打断同一待遇)
      setGap(null)
      setCross(null)
      finishWithSettle({ type: 'none' }, false)
    }

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') cancel()
    }

    // 窗被切走/藏起 = 这趟拖拽作废(产品裁定:只有本窗点着才算在拖):
    // blur/藏起走 cancel 飞回;还没过拖拽阈值的按下同样关闭(cancel 内部按 started 分流)
    const onVisChange = (): void => {
      if (doc.visibilityState === 'hidden') cancel()
    }

    view.addEventListener('pointermove', move)
    view.addEventListener('pointerup', up)
    view.addEventListener('pointercancel', cancel)
    view.addEventListener('blur', cancel)
    doc.addEventListener('visibilitychange', onVisChange)
    // 浏览器侧主动收回捕获(失焦常见):捕获一丢 move/up 路由全断,也只能取消
    el.addEventListener('lostpointercapture', cancel)
  }

  // 被拖签的家在哪条带:本组递活序滑动账,别家条带照常递 margin 缝
  const dragSrcGroupId = drag
    ? (groups.find((g) => g.tabs.some((t) => t.id === drag.id))?.id ?? null)
    : null
  // 芯片隐身条件:活序滑动中真身亲自跟指针,替身胶囊退场(opacity 渐隐,带内带外换手不闪)
  const chipHidden =
    drag !== null && drag.phase === 'drag' && gap !== null && gap.groupId === dragSrcGroupId

  return { drag, gap, cross, chipRef, beginTabDrag, dragSrcGroupId, chipHidden }
}
