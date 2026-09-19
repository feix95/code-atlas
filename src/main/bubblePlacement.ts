// ── 气泡贴桌宠的落点(桌宠气泡锤,2026-09-19)──
// 桌宠能被拖到屏幕任意角落,气泡得跟着它走,不能再钉死主屏右下角。
// 口径学 mascotState:纯逻辑住这儿(不碰 electron),自测脚本拖得进来秒跑。
// 落点策略:默认弹桌宠上方(桌宠爱蹲右下角,往上长是屏内),上方塞不下弹下方,
// 两头都不够就挑空大的一侧夹回工作区;水平方向以桌宠为中心,整体夹回屏内。

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

/**
 * 气泡贴着 anchor(桌宠)落位。
 * workAreas 是各显示器的工作区;为空(理论兜底)就只回尺寸,坐标交给系统。
 * 认家规则跟桌宠存档一致:anchor 跟哪块屏交叠最大就认哪块。
 */
export function placeBubbleBox(anchor: PlacementBox, workAreas: PlacementBox[]): PlacementBox {
  if (workAreas.length === 0) return { x: 0, y: 0, width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT }
  let home = workAreas[0]
  let best = -1
  for (const wa of workAreas) {
    const area = overlapArea(anchor, wa)
    if (area > best) {
      best = area
      home = wa
    }
  }
  // 水平:以桌宠中轴居中,夹回工作区(屏比气泡还窄时贴左边,不往外跑)
  const x = clamp(anchor.x + anchor.width / 2 - BUBBLE_WIDTH / 2, home.x, Math.max(home.x, home.x + home.width - BUBBLE_WIDTH))
  // 垂直:上方够高弹上方,下方够高弹下方,都不够挑空大的一侧夹紧
  const spaceAbove = anchor.y - home.y
  const spaceBelow = home.y + home.height - (anchor.y + anchor.height)
  let y: number
  if (spaceAbove >= BUBBLE_HEIGHT + BUBBLE_GAP) y = anchor.y - BUBBLE_HEIGHT - BUBBLE_GAP
  else if (spaceBelow >= BUBBLE_HEIGHT + BUBBLE_GAP) y = anchor.y + anchor.height + BUBBLE_GAP
  else {
    const ideal = spaceAbove >= spaceBelow ? anchor.y - BUBBLE_HEIGHT - BUBBLE_GAP : anchor.y + anchor.height + BUBBLE_GAP
    y = clamp(ideal, home.y, Math.max(home.y, home.y + home.height - BUBBLE_HEIGHT))
  }
  return { x: Math.round(x), y: Math.round(y), width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT }
}
