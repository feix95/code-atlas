/**
 * 页签拖拽的落点几何(纯函数,不碰 DOM)。
 * 渲染(TabBar)与落点判定(TopBarTabs)共用同一份账:判的必须就是看的。
 */

/** 被拖签的投影中心:x 是指针位置,芯片左缘跟着抓握点走,中心落在它右半张处 */
export function dragCenterX(pointerX: number, grabDx: number, width: number): number {
  return pointerX - grabDx + width / 2
}

/**
 * 插入序:越过第几张签的中线就插到它前面,一张都没过 = 队尾。
 * 中线取自拖拽开始时的快照 —— 拖拽期间 DOM 会动(本组活序滑动),逐帧重量会把判定
 * 自己拽着跑,反而会抖。
 */
export function insertIndexAt(centers: readonly number[], cursorX: number): number {
  for (let i = 0; i < centers.length; i += 1) {
    if (centers[i] > cursorX) return i
  }
  return centers.length
}

/** 条带判定出血量:光标擦到条带边缘/组间细柱上也算悬在带上 */
export const STRIP_BLEED_X = 6
export const STRIP_BLEED_TOP = 4
export const STRIP_BLEED_BOTTOM = 8

/** 拆窗磁性带:条带贴着窗口顶边,指针离条带这么近就仍算在带上(只重排不拆窗)。
    口径同 Chromium 的 detach magnetism,数值放大一档 —— 我们的条带顶边就是窗口顶边 */
export const DETACH_MAGNETISM_PX = 32

/** 条带矩形(视口坐标)+ 各向出血量 */
export interface StripBand {
  left: number
  right: number
  top: number
  bottom: number
  bleedTop: number
  bleedBottom: number
  bleedX: number
}

/**
 * 指针是否还在条带的磁性带内(Chromium 的 detach magnetism):带内一律算「还在条带上」,
 * 只重排、不拆窗。条带贴着窗口顶边,不设这道带的话指针向上几像素就出窗、被误判成拆窗。
 */
export function isWithinStripBand(
  pointX: number,
  pointY: number,
  strip: StripBand,
  magnetism: number
): boolean {
  return (
    pointY >= strip.top - strip.bleedTop - magnetism &&
    pointY <= strip.bottom + strip.bleedBottom + magnetism &&
    pointX >= strip.left - strip.bleedX &&
    pointX <= strip.right + strip.bleedX
  )
}
