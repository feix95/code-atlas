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
