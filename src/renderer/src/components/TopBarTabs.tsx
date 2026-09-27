// 顶栏页签区(UI v3 · §5.1 Chrome 式):每个页签组一条胶囊带,
// 条带与下方分屏列一一对齐 —— 第一组按 paneSplit 占宽,
// 两组之间的细柱 = 下方分割条中线的上延。
// 几何账:顶栏页签区比内容列窄一个窗控块(3×1u);页签区与内容列同起点,
// 折成 「组宽% + 占比×3u」 的纯加减式,窗控宽挂 --u 跟着缩放,不写死 rem。
//
// 页签拖拽是手搓 pointer 引擎(不吃 HTML5 DnD —— 原生幻影带黑框、没有让位动画):
// 按住位移超阈值开拖 → 原页签塌缩成空位,替身芯片浮起跟光标;扫过页签带时
// 邻居 margin 过渡撑开落点缝;悬到正文区按中心/边缘判分屏许诺;窗外松手撕新子窗。
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PaneGroup, PaneTab, PaneViewMode } from '../paneTabs'
import { TreeIcon } from './Icons'
import { TabBar, type TabBarTab } from './TabBar'

/** 窗控三键总宽 3u(每钮 1u):页签区右端比内容列右端短这么一截,对齐账里要补回来 */
const WIN_CTL_U = 3
/** 按住位移阈值:超了才算拖,普通点按照旧走 onClick 激活页签 */
const DRAG_START_PX = 4
/** 页签带判定的出血量:光标擦到条带边缘/组间细柱上也还算悬在带上 */
const STRIP_BLEED_X = 6
const STRIP_BLEED_TOP = 4
const STRIP_BLEED_BOTTOM = 8
/** 正文区边缘分屏带的横向占比(封顶 120px):贴到亮半边提示 —— VS Code 同款手势 */
/** 定向拆半屏的判定带:正文左右各 1/3 宽、全高都算数(小葵定的手感:拖到三分之一就亮蓝) */
const SPLIT_EDGE_THIRD = 1 / 3
/** 芯片松手后的淡出时长(拖出窗撕新子窗那条路) */
const CHIP_FADE_MS = 140
/** 沉降飞行时长:芯片飞回落点长成页签(与 CSS is-settle 的过渡时长对齐) */
const CHIP_SETTLE_MS = 210

/** 拖拽芯片的生命周期:born=隐形量内容宽;enter=出生成原页签模样;
   drag=收成紧凑胶囊跟光标;settle=飞回落点长回页签(再把真身换上场) */
type ChipPhase = 'born' | 'enter' | 'drag' | 'settle'

/** 沉降的落点矩形(视口坐标):芯片飞到这里长成页签 */
interface SettleRect {
  left: number
  top: number
  width: number
  height: number
}

/** 拖拽芯片的呈现账本:替身长什么样、抓握偏移、跟到哪儿、是不是正在淡出 */
interface TabDragState {
  id: string
  icon: string
  name: string
  /** 源页签的出生矩形(视口坐标):enter 阶段照它克隆,取消时飞回 */
  srcLeft: number
  srcTop: number
  width: number
  height: number
  /** 紧凑胶囊量出来的内容宽/高(born 阶段量一次):enter→drag 的形变目标 */
  compactW: number
  compactH: number
  grabDx: number
  grabDy: number
  x: number
  y: number
  phase: ChipPhase
  settle?: SettleRect
  leaving: boolean
}

/** 一条页签带的几何快照:拖动开始时量一次 —— 让位动画期间 DOM 一直在动,不能逐帧问它 */
interface StripSnap {
  groupId: string
  left: number
  right: number
  top: number
  bottom: number
  /** 内层 .tabbar 的左缘(视口坐标):插入线的 x 按它折回带内坐标 */
  barLeft: number
  /** 各页签的横向户口(视口坐标):中线判插序,左右缘算插入线的落点 */
  mids: { id: string; left: number; mid: number; right: number }[]
}

interface BodySnap {
  groupId: string
  left: number
  right: number
  top: number
  bottom: number
}

/** 当前落点:页签带插队 / 正文分屏(中心或左右缘) / 窗外(撕新子窗) / 无处(松手不动作) */
type DragZone =
  | { type: 'strip'; groupId: string; index: number }
  | { type: 'pane'; groupId: string; zone: 'center' | 'left' | 'right' }
  | { type: 'outside' }
  | { type: 'none' }

export function TopBarTabs({
  groups,
  visibleOfGroup,
  flashTabId,
  activateTab,
  closeTab,
  moveTab,
  setDropMark,
  onTabDragEnd,
  onDetachTab,
  onSetViewMode,
  onRevealInTree,
  workspaceRoot,
  paneSplit
}: {
  groups: PaneGroup[]
  visibleOfGroup: (g: PaneGroup | null) => PaneTab[]
  flashTabId: string | null
  activateTab: (id: string) => void
  closeTab: (id: string) => void
  /** 挪页签:toGroup 空 = 同组重排,'sibling' = 另一组(单组按 splitSide 拆新组) */
  moveTab: (
    id: string,
    toGroup: 'sibling' | null,
    atIndex: number | null,
    splitSide?: 'left' | 'right'
  ) => void
  setDropMark: React.Dispatch<
    React.SetStateAction<{ groupId: string; zone: 'center' | 'left' | 'right' } | null>
  >
  /** 拖出本窗松手(页签撕窗锤:撕去新子窗,语义由 App 定,这里只报是谁) */
  onTabDragEnd: (id: string) => void
  /** 右键菜单「移到新窗口」:不拖也撕,所有签一视同仁 */
  onDetachTab?: (id: string) => void
  /** 右键菜单「阅读/源码模式」:切文件签的看片档位(阅读模式这锤) */
  onSetViewMode?: (id: string, mode: PaneViewMode) => void
  /** 右键菜单「在文件列表中显示当前文件」:回侧栏树里指出来(App 的活) */
  onRevealInTree?: (id: string) => void
  /** 工作区根(文件动作拼路径的底;peek 签自带 scopeRoot 不看它) */
  workspaceRoot?: string | null
  /** 第一组分屏列占内容宽的比例(usePaneTabs 的账本,顶部条带认同一份) */
  paneSplit: number
}): React.JSX.Element {
  // 第一组条带宽 = paneSplit × 内容列宽。用页签区宽当分母折回:
  //   条带宽 = 占比 × (页签区宽 + 窗控宽)
  const firstBasis = `calc(${(paneSplit * 100).toFixed(3)}% + var(--u) * ${(WIN_CTL_U * paneSplit).toFixed(4)})`

  const [drag, setDrag] = useState<TabDragState | null>(null)
  // 落点缝开在哪条带、第几个空位(index 按「剔除被拖签」后的可见序数);
  const [gap, setGap] = useState<{ groupId: string; index: number } | null>(null)
  const chipRef = useRef<HTMLDivElement>(null)

  // born:芯片以紧凑胶囊态隐形上墙,量出内容宽高 → enter 把矩形改成源页签大小
  useLayoutEffect(() => {
    if (drag?.phase !== 'born' || !chipRef.current) return
    const r = chipRef.current.getBoundingClientRect()
    setDrag((d) =>
      d && d.phase === 'born' ? { ...d, compactW: r.width, compactH: r.height, phase: 'enter' } : d
    )
  }, [drag?.phase])

  // enter:至少让「页签模样」画上一帧,再放 phase→drag —— 收缩形变才有起帧
  useEffect(() => {
    if (drag?.phase !== 'enter') return
    const raf = requestAnimationFrame(() =>
      setDrag((d) => (d && d.phase === 'enter' ? { ...d, phase: 'drag' } : d))
    )
    return () => cancelAnimationFrame(raf)
  }, [drag?.phase])

  /** 页签 pointerdown 入场:先记起点,位移够阈值才升级成拖拽会话。
      监听挂 window(不捕获也收得到全部指针事件)—— 捕获得等确认开拖才上,
      不然 click 会被路由回页签,页签里的 × 钮整个失灵(亲历坑,别往回改)。
      realm 铁律(页签撕窗锤):Portal 渲染进子窗的页签住在另一个 document,
      监听/查询/视口量一律走 el.ownerDocument —— 挂全局 window 上子窗的拖拽全聋 */
  function beginTabDrag(e: React.PointerEvent<HTMLDivElement>, t: TabBarTab): void {
    if (e.button !== 0 || drag) return
    const el = e.currentTarget
    const doc = el.ownerDocument
    const view = doc.defaultView ?? window
    const rect = el.getBoundingClientRect()
    const grabDx = e.clientX - rect.left
    const grabDy = e.clientY - rect.top
    const srcGroupId = groups.find((g) => g.tabs.some((x) => x.id === t.id))?.id ?? null
    let started = false
    let captured = false
    let snaps: StripSnap[] = []
    let bodies: BodySnap[] = []
    let zone: DragZone = { type: 'none' }

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
    }

    const commitZone = (z: DragZone): void => {
      if (z.type === 'strip') {
        const dst = groups.find((g) => g.id === z.groupId)
        if (!dst) return
        // 缝的序号按剔除被拖签的可见序给;落进全量数组前把隐藏签占位折回去,
        // 空锚 = 落到末尾(顺手修了旧账:可见索引直接当全量索引用会插错位)
        const vis = visibleOfGroup(dst).filter((x) => x.id !== t.id)
        const anchorId = vis[z.index]?.id
        const pool = dst.tabs.filter((x) => x.id !== t.id)
        const at = anchorId === undefined ? null : pool.findIndex((x) => x.id === anchorId)
        moveTab(t.id, z.groupId === srcGroupId ? null : 'sibling', at === -1 ? null : at)
        return
      }
      if (z.type === 'pane') {
        if (z.zone === 'center') {
          // 中心松手:只认「别组页签挪来并组」;单组中心不动作(拆分走左右缘 —— 小葵拍板)
          if (srcGroupId !== z.groupId) moveTab(t.id, 'sibling', null)
        } else {
          moveTab(t.id, 'sibling', null, z.zone)
        }
      }
    }

    // 落点 → 沉降矩形(视口坐标):芯片飞过去长成页签的那一格;
    // 返回 null = 不飞(无处可去的松手淡处理)
    const settleRectFor = (z: DragZone): SettleRect | null => {
      if (z.type === 'strip') {
        const s = snaps.find((x) => x.groupId === z.groupId)
        if (!s) return null
        const mids = s.groupId === srcGroupId ? s.mids.filter((m) => m.id !== t.id) : s.mids
        // 落点缝 = 锚签原来站的那格:有锚签就取它的快照左缘,队尾贴末签右缘
        const left =
          z.index < mids.length
            ? mids[z.index].left
            : mids.length > 0
              ? mids[mids.length - 1].right + 2
              : s.barLeft + 10
        return { left, top: s.bottom - rect.height, width: rect.width, height: rect.height }
      }
      if (z.type === 'pane') {
        const s = snaps.find((x) => x.groupId === z.groupId)
        const b = bodies.find((x) => x.groupId === z.groupId)
        if (!b) return null
        const stripTop = s ? s.bottom - rect.height : rect.top
        if (z.zone === 'center' && s) {
          // 挪去现成的另一组:落那条带的末尾
          const endX = s.mids.length > 0 ? s.mids[s.mids.length - 1].right + 2 : s.barLeft + 10
          return { left: endX, top: stripTop, width: rect.width, height: rect.height }
        }
        // 单组拆栏(左右缘):新组还没长出来,用正文矩形 + paneSplit 推新条带在顶栏的落点 —
        // 左缘拆 = 新组在左,右缘 = 新组在右
        const bw = b.right - b.left
        const landX = z.zone === 'left' ? b.left + 10 : b.left + bw * paneSplit + 10
        return { left: landX, top: stripTop, width: rect.width, height: rect.height }
      }
      // 无处/取消:飞回源位
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }

    // 松手/取消的统一收尾:芯片沉降飞矩形,落地后才交账 + 收场
    const finishWithSettle = (z: DragZone, doCommit: boolean): void => {
      const target = settleRectFor(z)
      if (!target) {
        if (doCommit) commitZone(z)
        endSession()
        return
      }
      setDrag((d) => (d ? { ...d, phase: 'settle', settle: target } : d))
      setDropMark(null) // 正文提示可以撤了,沉降本身就是反馈;页签缝留着接芯片落地
      view.setTimeout(() => {
        if (doCommit) commitZone(z)
        endSession()
      }, CHIP_SETTLE_MS)
    }

    const move = (ev: PointerEvent): void => {
      // 失焦期间窗外松手会吃掉 pointerup(事件转给别家窗):按键早没了
      // 却还在收 move = 松手被吞了,按取消收摊 —— Alt+Tab 切走/截图工具抢焦点同病
      if ((ev.buttons & 1) === 0) {
        cancel()
        return
      }
      const cx = ev.clientX
      const cy = ev.clientY
      if (!started) {
        if (Math.abs(cx - e.clientX) + Math.abs(cy - e.clientY) < DRAG_START_PX) return
        started = true
        // 此刻才捕获:窗外坐标还能继续报(拖出窗撕新窗指望它),
        // 而此前 × 钮/右键的 click 走正常派发,不受影响
        el.setPointerCapture(ev.pointerId)
        captured = true
        doc.body.classList.add('is-tab-dragging')
        // 主动收摊:按住没动的那 300ms 里提示可能已经合法亮过,捕获一上 mouseout 全拐回源签
        // (relatedTarget 还在宿内→tooltip 永远收不到「离开」),不喊一声它就冻在屏上陪完整个拖拽
        doc.dispatchEvent(new CustomEvent('atlas:tab-drag-start'))
        view.addEventListener('keydown', onKey)
        // 几何快照只量一次:让位动画一开,DOM 坐标逐帧在变,问它要账会被晃点;
        // 只量本窗(doc)里的带和正文 —— 别家窗的条带不归这次拖拽管
        snaps = Array.from(doc.querySelectorAll<HTMLElement>('.topbar-strip')).map((s, i) => {
          const r = s.getBoundingClientRect()
          return {
            groupId: groups[i]?.id ?? '',
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            barLeft:
              s.querySelector<HTMLElement>('.tabbar')?.getBoundingClientRect().left ?? r.left,
            mids: Array.from(s.querySelectorAll<HTMLElement>('.tabbar-tab')).map((te) => {
              const tr = te.getBoundingClientRect()
              return {
                id: te.dataset.tabId ?? '',
                left: tr.left,
                mid: (tr.left + tr.right) / 2,
                right: tr.right
              }
            })
          }
        })
        bodies = Array.from(doc.querySelectorAll<HTMLElement>('.pane-body')).map((b) => {
          const r = b.getBoundingClientRect()
          return {
            groupId: b.dataset.groupId ?? '',
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom
          }
        })
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
          phase: 'born',
          leaving: false
        })
        return
      }
      setDrag((d) => (d ? { ...d, x: cx, y: cy } : d))
      // ── 落点判定:窗外 → 页签带 → 正文区 → 无处 ──
      if (cx < 0 || cy < 0 || cx >= view.innerWidth || cy >= view.innerHeight) {
        zone = { type: 'outside' }
        setGap(null)
        setDropMark(null)
        return
      }
      let hit = false
      for (const s of snaps) {
        if (
          cy >= s.top - STRIP_BLEED_TOP &&
          cy <= s.bottom + STRIP_BLEED_BOTTOM &&
          cx >= s.left - STRIP_BLEED_X &&
          cx <= s.right + STRIP_BLEED_X
        ) {
          const mids = s.groupId === srcGroupId ? s.mids.filter((m) => m.id !== t.id) : s.mids
          let index = mids.findIndex((m) => m.mid > cx)
          if (index < 0) index = mids.length
          zone = { type: 'strip', groupId: s.groupId, index }
          setGap((prev) =>
            prev && prev.groupId === s.groupId && prev.index === index
              ? prev
              : { groupId: s.groupId, index }
          )
          setDropMark(null)
          hit = true
          break
        }
      }
      if (!hit) {
        for (const b of bodies) {
          if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) continue
          const relX = (cx - b.left) / (b.right - b.left)
          const srcGroup = groups.find((g) => g.id === srcGroupId)
          if (relX <= SPLIT_EDGE_THIRD || relX >= 1 - SPLIT_EDGE_THIRD) {
            // 左右三分之一带 = 定向拆半屏(全高都算):单组且拆了不空才许诺,免得画空头支票
            if (groups.length === 1 && srcGroup && srcGroup.tabs.length > 1) {
              const side = relX < 0.5 ? 'left' : 'right'
              zone = { type: 'pane', groupId: b.groupId, zone: side }
              setDropMark((prev) =>
                prev?.groupId === b.groupId && prev.zone === side
                  ? prev
                  : { groupId: b.groupId, zone: side }
              )
              hit = true
            }
          } else if (srcGroupId !== b.groupId) {
            // 中段三分之一 = 中心许诺:只对别组画「挪到这一组」;自家组中心不画饼
            zone = { type: 'pane', groupId: b.groupId, zone: 'center' }
            setDropMark((prev) =>
              prev?.groupId === b.groupId && prev.zone === 'center'
                ? prev
                : { groupId: b.groupId, zone: 'center' }
            )
            hit = true
          }
          break // 光标只可能落在这一块正文里,命中与否都不必再看别块
        }
      }
      if (!hit) {
        zone = { type: 'none' }
        setGap(null)
        setDropMark(null)
      } else if (zone.type !== 'strip') {
        setGap(null)
      }
    }

    const up = (): void => {
      removeListeners()
      if (!started) return // 普通点按:click 照常激活
      swallowClick()
      const z = zone
      if (z.type === 'outside') {
        // 拖出窗撕新窗:不走沉降(窗外没落点),原地淡出交账
        onTabDragEnd(t.id)
        setGap(null)
        setDropMark(null)
        setDrag((d) => (d ? { ...d, leaving: true } : d))
        // 淡出计时按 id 守卫:淡出内开新拖,别误杀新会话的芯片
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
      finishWithSettle({ type: 'none' }, false)
    }

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') cancel()
    }

    // 窗被切走/藏起 = 这趟拖拽作废(小葵拍板:只有本窗点着才算在拖):
    // blur/藏起走 cancel 飞回;还没过拖拽阈值的按下同样收摊(cancel 内部按 started 分流)
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

  return (
    <>
      {groups.map((g, gi) => (
        <Fragment key={g.id}>
          {gi > 0 && <div className="topbar-split" aria-hidden="true" />}
          <div
            className="topbar-strip"
            style={groups.length === 2 && gi === 0 ? { flex: `0 0 ${firstBasis}` } : undefined}
          >
            <TabBar
              tabs={visibleOfGroup(g)}
              activeId={g.activeId}
              flashId={flashTabId}
              canMoveToSiblingGroup={groups.length > 1}
              onActivate={activateTab}
              onClose={closeTab}
              onMoveTab={moveTab}
              onDetachTab={onDetachTab}
              onSetViewMode={onSetViewMode}
              onRevealInTree={onRevealInTree}
              workspaceRoot={workspaceRoot}
              dragSourceId={drag?.id ?? null}
              gapIndex={gap?.groupId === g.id ? gap.index : null}
              gapWidth={drag?.width ?? 0}
              onTabPointerDown={beginTabDrag}
            />
          </div>
        </Fragment>
      ))}
      {/* 拖拽替身芯片:fixed 浮层(.tabbar overflow:hidden 会裁掉行内位移的替身),
          抓握偏移让芯片像被指尖拎着;pointer-events 全让,别挡底下落点判定。
          生命周期:born 隐形量紧凑宽 → enter 克隆页签模样出生 →
          drag 收成胶囊跟光标(is-morph 只管尺寸/配色,位置零延迟跟手)→
          settle 飞回落点长回页签(is-settle 连位置一起过渡,落地帧换真身) */}
      {drag && (
        <div
          ref={chipRef}
          className={`tabbar-tab is-chip${drag.phase === 'drag' ? ' is-morph' : ''}${
            drag.phase === 'settle' ? ' is-settle is-tablook' : ''
          }${drag.phase === 'enter' ? ' is-tablook' : ''}${drag.leaving ? ' is-leaving' : ''}`}
          style={
            drag.phase === 'born'
              ? { left: drag.srcLeft, top: drag.srcTop, width: 'auto', opacity: 0 }
              : drag.phase === 'enter'
                ? {
                    left: drag.srcLeft,
                    top: drag.srcTop,
                    width: drag.width,
                    height: drag.height
                  }
                : drag.phase === 'settle' && drag.settle
                  ? {
                      left: drag.settle.left,
                      top: drag.settle.top,
                      width: drag.settle.width,
                      height: drag.settle.height
                    }
                  : {
                      left: drag.x - drag.grabDx,
                      top: drag.y - drag.grabDy,
                      width: drag.compactW,
                      height: drag.compactH
                    }
          }
          aria-hidden="true"
        >
          <span className="tabbar-icon" aria-hidden="true">
            <TreeIcon name={drag.icon} mono />
          </span>
          <span className="tabbar-name">{drag.name}</span>
        </div>
      )}
    </>
  )
}
