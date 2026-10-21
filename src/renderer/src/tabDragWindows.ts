/**
 * 跨窗页签拖拽的几何账(纯函数为主):
 * 拖拽开始时量一次各窗的页签带/正文,指针出了来源窗就按屏幕坐标找目标窗,
 * 再换算成目标窗局部坐标套用同一套条带/正文判定。
 *
 * 为什么不自己用 window.screenX:无边框窗的 screenX 含隐形边框(实测偏 8px),
 * 内容区原点由主进程 getContentBounds 给(见 AuxWindowRect),两边才是同一坐标系。
 */
import type { AuxWindowRect } from '@shared/types'
import {
  DETACH_MAGNETISM_PX,
  dragCenterX,
  insertIndexAt,
  isWithinStripBand,
  STRIP_BLEED_BOTTOM,
  STRIP_BLEED_TOP,
  STRIP_BLEED_X
} from './tabDragGeometry.ts'

/** 一扇可参与落点的窗:host 与页签组登记同名('main' / 'aux-N') */
export interface DragWindowRef {
  host: string
  win: Window
}

/** 一条页签带的局部快照(坐标平铺,与拖拽引擎现有账同形) */
export interface StripSnap {
  host: string
  groupId: string
  left: number
  top: number
  right: number
  bottom: number
  /** .tabbar 左缘:空条带画插入线时的兜底落点 */
  barLeft: number
  /** 各签左缘/中线/右缘(局部坐标) */
  mids: { id: string; left: number; mid: number; right: number }[]
}

/** 一块正文的局部快照;groupId 为空 = 该窗没有页签组(主窗拖空后的兜底落点) */
export interface BodySnap {
  host: string
  groupId: string | null
  left: number
  top: number
  right: number
  bottom: number
}

/** 一扇窗的局部快照 + 屏幕矩形 */
export interface WindowSnap {
  host: string
  x: number
  y: number
  width: number
  height: number
  strips: StripSnap[]
  bodies: BodySnap[]
}

/**
 * 量一次所有窗的页签带与正文。窗口已关、被最小化/隐藏、主进程没给矩形的一律跳过。
 * rects 来自 atlas.auxWindowRects(拖拽按下时取一次):窗口在拖拽期间不会动。
 */
export function snapshotDragWindows(
  refs: readonly DragWindowRef[],
  rects: readonly AuxWindowRect[],
  sourceHost: string
): WindowSnap[] {
  const byHost = new Map(rects.map((r) => [r.frameName, r]))
  const out: WindowSnap[] = []
  for (const ref of refs) {
    if (ref.win.closed) continue
    const doc = ref.win.document
    if (!doc || doc.hidden) continue
    const isSource = ref.host === sourceHost
    const rect = byHost.get(ref.host)
    // 来源窗必须有账(它自己的局部判定不依赖屏幕矩形);目标窗缺矩形就没法命中
    if (!rect && !isSource) continue
    if (rect && !rect.visible && !isSource) continue
    const strips: StripSnap[] = []
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.topbar-strip'))) {
      const groupId = el.dataset['groupId'] ?? ''
      if (groupId === '') continue
      const r = el.getBoundingClientRect()
      const bar = el.querySelector<HTMLElement>('.tabbar')
      strips.push({
        host: ref.host,
        groupId,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        barLeft: bar?.getBoundingClientRect().left ?? r.left,
        mids: Array.from(el.querySelectorAll<HTMLElement>('.tabbar-tab')).map((tabEl) => {
          const tr = tabEl.getBoundingClientRect()
          return {
            id: tabEl.dataset['tabId'] ?? '',
            left: tr.left,
            mid: (tr.left + tr.right) / 2,
            right: tr.right
          }
        })
      })
    }
    const bodies: BodySnap[] = []
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.pane-body'))) {
      const r = el.getBoundingClientRect()
      bodies.push({
        host: ref.host,
        groupId: el.dataset['groupId'] ?? null,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom
      })
    }
    // 这扇窗一张组都没有(主窗把签全拖空了):正文整块当兜底落点,组 id 记空
    if (strips.length === 0 && bodies.length === 0) {
      const fallback = doc.querySelector<HTMLElement>('.detail, .pane-groups')
      if (fallback) {
        const r = fallback.getBoundingClientRect()
        bodies.push({
          host: ref.host,
          groupId: null,
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom
        })
      }
    }
    out.push({
      host: ref.host,
      x: rect?.x ?? 0,
      y: rect?.y ?? 0,
      width: rect?.width ?? ref.win.innerWidth,
      height: rect?.height ?? ref.win.innerHeight,
      strips,
      bodies
    })
  }
  return out
}

/**
 * 按屏幕坐标找目标窗(调用方按「前到后」排好序,来源窗会被跳过)。
 * 返回目标窗快照 + 换算好的局部坐标;不在任何窗里回 null。
 */
export function windowAtPoint(
  windows: readonly WindowSnap[],
  screenX: number,
  screenY: number,
  sourceHost: string
): { snap: WindowSnap; localX: number; localY: number } | null {
  for (const snap of windows) {
    if (snap.host === sourceHost) continue
    if (screenX < snap.x || screenX >= snap.x + snap.width) continue
    if (screenY < snap.y || screenY >= snap.y + snap.height) continue
    return { snap, localX: screenX - snap.x, localY: screenY - snap.y }
  }
  return null
}

/** 局部点落在哪条页签带上(带磁性带出血);没有回 null */
export function stripAtPoint(
  strips: readonly StripSnap[],
  localX: number,
  localY: number
): StripSnap | null {
  for (const strip of strips) {
    if (
      isWithinStripBand(
        localX,
        localY,
        {
          left: strip.left,
          right: strip.right,
          top: strip.top,
          bottom: strip.bottom,
          bleedTop: STRIP_BLEED_TOP,
          bleedBottom: STRIP_BLEED_BOTTOM,
          bleedX: STRIP_BLEED_X
        },
        DETACH_MAGNETISM_PX
      )
    )
      return strip
  }
  return null
}

/** 局部点落在哪块正文里;没有回 null */
export function bodyAtPoint(
  bodies: readonly BodySnap[],
  localX: number,
  localY: number
): BodySnap | null {
  for (const body of bodies) {
    if (localX >= body.left && localX <= body.right && localY >= body.top && localY <= body.bottom)
      return body
  }
  return null
}

/** 插入序号:判定看被拖签的投影中心,与来源窗内的口径完全一致 */
export function gapIndexAt(
  strip: StripSnap,
  localX: number,
  grabDx: number,
  chipW: number
): number {
  return insertIndexAt(
    strip.mids.map((m) => m.mid),
    dragCenterX(localX, grabDx, chipW)
  )
}

/** 插入线的横坐标:有锚签取锚签左缘,队尾贴末签右缘,空带贴带内左边 */
export function gapLeftAt(strip: StripSnap, index: number): number {
  if (strip.mids.length === 0) return strip.barLeft + 10
  if (index < strip.mids.length) return strip.mids[index].left
  return strip.mids[strip.mids.length - 1].right + 2
}
