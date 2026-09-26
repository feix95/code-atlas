// 顶栏页签区(UI v3 · §5.1 Chrome 式):每个页签组一条胶囊带,
// 条带与下方分屏列一一对齐 —— 第一组按 paneSplit 占宽,
// 两组之间的细柱 = 下方分割条中线的上延。
// 几何账:顶栏页签区比内容列窄一个窗控块(3×1u);页签区与内容列同起点,
// 折成 「组宽% + 占比×3u」 的纯加减式,窗控宽挂 --u 跟着缩放,不写死 rem。
//
// 页签拖拽是手搓 pointer 引擎(不吃 HTML5 DnD —— 原生幻影带黑框、没有让位动画):
// 按住位移超阈值开拖 → 原页签塌缩成空位,替身芯片浮起跟光标;扫过页签带时
// 邻居 margin 过渡撑开落点缝;悬到正文区按中心/边缘判分屏许诺;窗外松手放小探针。
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PaneGroup, PaneTab } from '../paneTabs'
import type { PaneKind } from '../paneKinds'
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
const EDGE_BAND_RATIO = 0.14
const EDGE_BAND_MAX_PX = 120
/** 芯片松手后的淡出时长(拖出窗放小探针那条路) */
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
  pinned: boolean
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

/** 当前落点:页签带插队 / 正文分屏(中心或左右缘) / 窗外(放小探针) / 无处(松手不动作) */
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
  pinToggleTab,
  moveTab,
  setDropMark,
  onTabDragEnd,
  onDetachTab,
  enabledKinds,
  toggleKind,
  paneSplit
}: {
  groups: PaneGroup[]
  visibleOfGroup: (g: PaneGroup | null) => PaneTab[]
  flashTabId: string | null
  activateTab: (id: string) => void
  closeTab: (id: string) => void
  pinToggleTab: (id: string) => void
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
  /** 拖出主窗松手(走出面板锤:放出小探针的落点语义由 App/主进程判,这里只报是谁) */
  onTabDragEnd: (id: string) => void
  /** 右键菜单「放到桌面」:不拖也放,只对小探针页签显示 */
  onDetachTab?: (id: string) => void
  enabledKinds: Set<PaneKind>
  toggleKind: (kind: PaneKind, on: boolean) => void
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
      不然 click 会被路由回页签,页签里的 × 钮整个失灵(亲历坑,别往回改) */
  function beginTabDrag(e: React.PointerEvent<HTMLDivElement>, t: TabBarTab): void {
    if (e.button !== 0 || drag) return
    const el = e.currentTarget
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
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKey)
      if (captured && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      document.body.classList.remove('is-tab-dragging')
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
          // 中心松手(老规矩):别组页签拖来 = 挪来这组;单组 = 拆两栏(落右)
          if (srcGroupId !== z.groupId || groups.length === 1) moveTab(t.id, 'sibling', null)
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
        if (z.zone === 'center' && groups.length > 1 && s) {
          // 挪去现成的另一组:落那条带的末尾
          const endX = s.mids.length > 0 ? s.mids[s.mids.length - 1].right + 2 : s.barLeft + 10
          return { left: endX, top: stripTop, width: rect.width, height: rect.height }
        }
        // 单组拆栏:新组还没长出来,用正文矩形 + paneSplit 推新条带在顶栏的落点 —
        // 左缘拆 = 新组在左,中心/右缘 = 新组在右
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
      window.setTimeout(() => {
        if (doCommit) commitZone(z)
        endSession()
      }, CHIP_SETTLE_MS)
    }

    const move = (ev: PointerEvent): void => {
      const cx = ev.clientX
      const cy = ev.clientY
      if (!started) {
        if (Math.abs(cx - e.clientX) + Math.abs(cy - e.clientY) < DRAG_START_PX) return
        started = true
        // 此刻才捕获:窗外坐标还能继续报(拖出窗放小探针指望它),
        // 而此前 × 钮/右键的 click 走正常派发,不受影响
        el.setPointerCapture(ev.pointerId)
        captured = true
        document.body.classList.add('is-tab-dragging')
        // 主动收摊:按住没动的那 300ms 里提示可能已经合法亮过,捕获一上 mouseout 全拐回源签
        // (relatedTarget 还在宿内→tooltip 永远收不到「离开」),不喊一声它就冻在屏上陪完整个拖拽
        document.dispatchEvent(new CustomEvent('atlas:tab-drag-start'))
        window.addEventListener('keydown', onKey)
        // 几何快照只量一次:让位动画一开,DOM 坐标逐帧在变,问它要账会被晃点
        snaps = Array.from(document.querySelectorAll<HTMLElement>('.topbar-strip')).map((s, i) => {
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
        bodies = Array.from(document.querySelectorAll<HTMLElement>('.pane-body')).map((b) => {
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
          pinned: t.pinned,
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
      if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) {
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
          const relY = (cy - b.top) / (b.bottom - b.top)
          const srcGroup = groups.find((g) => g.id === srcGroupId)
          if (relX > 0.25 && relX < 0.75 && relY > 0.25 && relY < 0.75) {
            // 中心许诺(老规矩原文):别组页签 = 挪组,单组 = 拆两栏;自己组中心不画饼
            if (srcGroupId !== b.groupId || groups.length === 1) {
              zone = { type: 'pane', groupId: b.groupId, zone: 'center' }
              setDropMark((prev) =>
                prev?.groupId === b.groupId && prev.zone === 'center'
                  ? prev
                  : { groupId: b.groupId, zone: 'center' }
              )
              hit = true
            }
          } else if (
            // 边缘带 = min(14% 宽, 120px):单组且拆了不空才许诺,免得画空头支票
            (cx - b.left <= Math.min(EDGE_BAND_RATIO * (b.right - b.left), EDGE_BAND_MAX_PX) ||
              b.right - cx <= Math.min(EDGE_BAND_RATIO * (b.right - b.left), EDGE_BAND_MAX_PX)) &&
            groups.length === 1 &&
            srcGroup &&
            srcGroup.tabs.length > 1
          ) {
            const side = relX < 0.5 ? 'left' : 'right'
            zone = { type: 'pane', groupId: b.groupId, zone: side }
            setDropMark((prev) =>
              prev?.groupId === b.groupId && prev.zone === side
                ? prev
                : { groupId: b.groupId, zone: side }
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
        // 拖出窗放小探针:不走沉降(窗外没落点),原地淡出交账
        onTabDragEnd(t.id)
        setGap(null)
        setDropMark(null)
        setDrag((d) => (d ? { ...d, leaving: true } : d))
        // 淡出计时按 id 守卫:淡出内开新拖,别误杀新会话的芯片
        window.setTimeout(
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

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
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
              onPinToggle={pinToggleTab}
              onMoveTab={moveTab}
              onDetachTab={onDetachTab}
              enabledKinds={enabledKinds}
              onToggleKind={toggleKind}
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
            <TreeIcon name={drag.pinned ? 'pin' : drag.icon} mono />
          </span>
          <span className="tabbar-name">{drag.name}</span>
        </div>
      )}
    </>
  )
}
