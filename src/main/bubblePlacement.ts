// ── 气泡贴桌宠的落点(桌宠气泡锤,2026-09-19)──
// 桌宠能被拖到屏幕任意角落,气泡得跟着它走,不能再钉死主屏右下角。
// 口径学 mascotState:纯逻辑住这儿(不碰 electron),自测脚本拖得进来秒跑。
// 落点策略:默认弹桌宠上方(桌宠爱蹲右下角,往上长是屏内),上方塞不下弹下方,
// 两头都不够就挑空大的一侧夹回工作区;水平方向以桌宠为中心,整体夹回屏内。
// 气泡放大锤(2026-09-21):尺寸不再钉死 —— placeBubbleBox 吃自定义尺寸(用户调过
// 的记忆尺寸),resizeBubbleBox 管拖拽缩放的对账(钉对侧边、夹最小值、不出屏)。

/** 一个矩形框:窗口 bounds / 显示器工作区都长这样 */
export interface PlacementBox {
  x: number
  y: number
  width: number
  height: number
}

/** 气泡窗的默认尺寸:和 bubble.ts 的窗参数一口约定,改一处必改两处 */
export const BUBBLE_WIDTH = 360
export const BUBBLE_HEIGHT = 480
/** 气泡能缩到的下限(气泡放大锤):再小就剩不下标题+消息+输入框了 */
export const BUBBLE_MIN_WIDTH = 280
export const BUBBLE_MIN_HEIGHT = 320
/** 气泡和桌宠之间留的缝:贴上不像长在一起,留缝才像「弹出来」 */
const BUBBLE_GAP = 8

/** 两个矩形的交叠面积(不叠回 0):挑「桌宠蹲在哪块屏」用 */
function overlapArea(a: PlacementBox, b: PlacementBox): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/** 认家:anchor 跟哪块屏交叠最大就认哪块(没屏可认回 null) */
function pickHome(anchor: PlacementBox, workAreas: PlacementBox[]): PlacementBox | null {
  let home: PlacementBox | null = null
  let best = -1
  for (const wa of workAreas) {
    const area = overlapArea(anchor, wa)
    if (area > best) {
      best = area
      home = wa
    }
  }
  return home
}

/**
 * 气泡贴着 anchor(桌宠)落位。
 * workAreas 是各显示器的工作区;为空(理论兜底)就只回尺寸,坐标交给系统。
 * size = 想要的尺寸(默认原始尺寸;用户调过的记忆尺寸走这进来),
 * 比家屏还大就先夹到家屏大小再落位。
 */
export function placeBubbleBox(
  anchor: PlacementBox,
  workAreas: PlacementBox[],
  size: { width: number; height: number } = { width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT }
): PlacementBox {
  if (workAreas.length === 0) return { x: 0, y: 0, width: size.width, height: size.height }
  const home = pickHome(anchor, workAreas) ?? workAreas[0]
  const width = Math.min(size.width, home.width)
  const height = Math.min(size.height, home.height)
  // 水平:以桌宠中轴居中,夹回工作区(屏比气泡还窄时贴左边,不往外跑)
  const x = clamp(
    anchor.x + anchor.width / 2 - width / 2,
    home.x,
    Math.max(home.x, home.x + home.width - width)
  )
  // 垂直:上方够高弹上方,下方够高弹下方,都不够挑空大的一侧夹紧
  const spaceAbove = anchor.y - home.y
  const spaceBelow = home.y + home.height - (anchor.y + anchor.height)
  let y: number
  if (spaceAbove >= height + BUBBLE_GAP) y = anchor.y - height - BUBBLE_GAP
  else if (spaceBelow >= height + BUBBLE_GAP) y = anchor.y + anchor.height + BUBBLE_GAP
  else {
    const ideal =
      spaceAbove >= spaceBelow
        ? anchor.y - height - BUBBLE_GAP
        : anchor.y + anchor.height + BUBBLE_GAP
    y = clamp(ideal, home.y, Math.max(home.y, home.y + home.height - height))
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

/** 拖拽缩放的方向:八个手柄位(n/s/e/w 边中段,ne/nw/se/sw 角)。
 * 户口在 shared/types.ts(IPC 契约),这儿转口给主进程和自测用 */
import type { BubbleResizeDir } from '../shared/types.ts'
export type { BubbleResizeDir }

/**
 * 拖拽缩放的纯对账(气泡放大锤):给「按下时的窗框 + 方向 + 按下光标 + 当前光标」,
 * 算新窗框 —— 普通窗口的老规矩:拖哪个角/边,对侧那条边钉死不动。
 * 三条箍:最小尺寸夹底;不能长出家屏工作区(往屏外长就停在沿口);
 * 钉住的那条边在屏外的(理论上不该有)也顺手夹回。
 * workAreas 为空就只管最小值,不夹屏界。
 */
export function resizeBubbleBox(
  start: PlacementBox,
  dir: BubbleResizeDir,
  from: { x: number; y: number },
  to: { x: number; y: number },
  workAreas: PlacementBox[]
): PlacementBox {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const home = pickHome(start, workAreas)
  let width = start.width
  let height = start.height
  if (dir.includes('e')) width = start.width + dx
  if (dir.includes('w')) width = start.width - dx
  if (dir.includes('s')) height = start.height + dy
  if (dir.includes('n')) height = start.height - dy
  width = Math.max(BUBBLE_MIN_WIDTH, width)
  height = Math.max(BUBBLE_MIN_HEIGHT, height)
  if (home) {
    // 往哪边长,上限就是「家屏沿口到对侧边」的距离 —— 长过头夹住,不许出屏
    if (dir.includes('e')) width = Math.min(width, home.x + home.width - start.x)
    if (dir.includes('w')) width = Math.min(width, start.x + start.width - home.x)
    if (dir.includes('s')) height = Math.min(height, home.y + home.height - start.y)
    if (dir.includes('n')) height = Math.min(height, start.y + start.height - home.y)
    width = Math.min(width, home.width)
    height = Math.min(height, home.height)
  }
  // 钉对侧边:往西/北长的,右/下边钉死,反推回 x/y
  const x = dir.includes('w') ? start.x + start.width - width : start.x
  const y = dir.includes('n') ? start.y + start.height - height : start.y
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}
