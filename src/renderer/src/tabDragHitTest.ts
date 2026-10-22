// 页签拖拽的落点判定:吃按下时量好的几何快照,吐「落哪儿 + 画什么提示」。
// 全是纯计算 —— 判定只认快照,不在拖拽途中回读 DOM(活序滑动会逐帧改坐标)。
import type { PaneGroup } from './paneTabs'
import {
  DETACH_MAGNETISM_PX,
  dragCenterX,
  insertIndexAt,
  isWithinStripBand,
  STRIP_BLEED_BOTTOM,
  STRIP_BLEED_TOP,
  STRIP_BLEED_X
} from './tabDragGeometry'
import {
  bodyAtPoint,
  gapIndexAt,
  gapLeftAt,
  stripAtPoint,
  windowAtPoint,
  type BodySnap,
  type StripSnap,
  type WindowSnap
} from './tabDragWindows'
import {
  SPLIT_EDGE_THIRD,
  type CrossProbe,
  type DragZone,
  type LocalProbe,
  type SettleRect,
  type SourceRect
} from './tabDragTypes'

/** 指针是否落在某条带的磁性带里(含上下左右溢出量) */
function inStripBand(cx: number, cy: number, s: StripSnap): boolean {
  return isWithinStripBand(
    cx,
    cy,
    {
      left: s.left,
      right: s.right,
      top: s.top,
      bottom: s.bottom,
      bleedTop: STRIP_BLEED_TOP,
      bleedBottom: STRIP_BLEED_BOTTOM,
      bleedX: STRIP_BLEED_X
    },
    DETACH_MAGNETISM_PX
  )
}

/**
 * 本窗内的落点:先认页签带(插队),再认正文边缘(单组拆半屏),都不中 = 无处可去。
 * 正文只许诺分屏、不接收页签:挪组一律走目标页签带,同一动作只留一种反馈。
 */
export function probeLocalZone(input: {
  cx: number
  cy: number
  snaps: readonly StripSnap[]
  bodies: readonly BodySnap[]
  groups: PaneGroup[]
  srcGroupId: string | null
  tabId: string
  rect: SourceRect
  grabDx: number
  /** 替身胶囊的实宽:别家条带的命中中心按它算,中心才跟眼睛对得上 */
  chipWidth: number
}): LocalProbe {
  const { cx, cy, snaps, bodies, groups, srcGroupId, tabId, rect, grabDx, chipWidth } = input

  for (const s of snaps) {
    if (!inStripBand(cx, cy, s)) continue
    const mids = s.groupId === srcGroupId ? s.mids.filter((m) => m.id !== tabId) : s.mids
    // 判定看被拖签的投影中心,不是裸指针:抓在签的哪一头会差出小半张签宽
    const probeW = s.groupId === srcGroupId ? rect.width : chipWidth
    const index = insertIndexAt(
      mids.map((m) => m.mid),
      dragCenterX(cx, grabDx, probeW)
    )
    return {
      zone: { type: 'strip', groupId: s.groupId, index },
      gap: { groupId: s.groupId, index },
      dropMark: null
    }
  }

  for (const b of bodies) {
    if (!b.groupId) continue
    const groupId = b.groupId
    if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) continue
    const relX = (cx - b.left) / (b.right - b.left)
    const srcGroup = groups.find((g) => g.id === srcGroupId)
    // 左右三分之一带 = 定向拆半屏(全高都算):单组且拆了不空才许诺,免得画空头支票
    if (
      (relX <= SPLIT_EDGE_THIRD || relX >= 1 - SPLIT_EDGE_THIRD) &&
      groups.length === 1 &&
      srcGroup &&
      srcGroup.tabs.length > 1
    ) {
      const side = relX < 0.5 ? 'left' : 'right'
      return {
        zone: { type: 'pane', groupId, zone: side },
        gap: null,
        dropMark: { groupId, zone: side }
      }
    }
    break // 光标只可能落在这一块正文里,命中与否都不必再看别块
  }

  return { zone: { type: 'none' }, gap: null, dropMark: null }
}

/**
 * 跨窗落点:按屏幕坐标找目标窗,换算成目标窗局部坐标后套同一套判定。
 * 后开的窗优先命中:Electron 不暴露窗口 z 序,子窗通常晚于父窗/旧子窗打开,
 * 反过来喂给 windowAtPoint 是重叠时最接近「看到哪扇就落哪扇」的近似。
 */
export function probeCrossZone(input: {
  screenX: number
  screenY: number
  windowSnaps: readonly WindowSnap[]
  host: string
  grabDx: number
  chipWidth: number
}): CrossProbe {
  const { screenX, screenY, windowSnaps, host, grabDx, chipWidth } = input
  const hitWindow = windowAtPoint([...windowSnaps].reverse(), screenX, screenY, host)
  if (!hitWindow) return { zone: { type: 'outside' }, cross: null }

  const { snap, localX, localY } = hitWindow
  const strip = stripAtPoint(snap.strips, localX, localY)
  if (strip) {
    const index = gapIndexAt(strip, localX, grabDx, chipWidth)
    const lineX = gapLeftAt(strip, index)
    const lineY = (strip.top + strip.bottom) / 2
    return {
      zone: { type: 'host-strip', host: snap.host, groupId: strip.groupId, index },
      cross: { host: snap.host, kind: 'strip', x: localX, y: localY, lineX, lineY, body: null }
    }
  }

  const body = bodyAtPoint(snap.bodies, localX, localY)
  if (body) {
    return {
      zone: { type: 'host-body', host: snap.host, groupId: body.groupId },
      cross: {
        host: snap.host,
        kind: 'body',
        x: localX,
        y: localY,
        lineX: null,
        lineY: null,
        body: {
          left: body.left,
          top: body.top,
          width: body.right - body.left,
          height: body.bottom - body.top
        }
      }
    }
  }

  // 落进目标窗但不在条带/正文(侧栏、窗控、空白):也算并入该窗第一组,别让人白拖
  return {
    zone: { type: 'host-body', host: snap.host, groupId: null },
    cross: {
      host: snap.host,
      kind: 'body',
      x: localX,
      y: localY,
      lineX: null,
      lineY: null,
      body: null
    }
  }
}

/**
 * 落点 → 沉降矩形(视口坐标):芯片飞过去长成页签的那一格;
 * 返回 null = 不飞(无处可去的松手淡处理)。
 */
export function settleRectFor(input: {
  zone: DragZone
  snaps: readonly StripSnap[]
  bodies: readonly BodySnap[]
  srcGroupId: string | null
  tabId: string
  rect: SourceRect
  paneSplit: number
}): SettleRect | null {
  const { zone: z, snaps, bodies, srcGroupId, tabId, rect, paneSplit } = input

  if (z.type === 'strip') {
    const s = snaps.find((x) => x.groupId === z.groupId)
    if (!s) return null
    const mids = s.groupId === srcGroupId ? s.mids.filter((m) => m.id !== tabId) : s.mids
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
    // 单组拆栏(左右缘):新组还没长出来,用正文矩形 + paneSplit 推新条带在顶栏的落点 ——
    // 左缘拆 = 新组在左,右缘 = 新组在右
    const bw = b.right - b.left
    const landX = z.zone === 'left' ? b.left + 10 : b.left + bw * paneSplit + 10
    return { left: landX, top: stripTop, width: rect.width, height: rect.height }
  }

  // 无处/取消:飞回源位
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}
