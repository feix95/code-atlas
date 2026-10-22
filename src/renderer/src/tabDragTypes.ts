// 页签拖拽的类型与手感常量:会话、落点判定、页签带三处共用一份。
import type { PaneDropMark } from './paneTabs'
import type { AuxWindowRect } from '@shared/types'
import type { TabBarTab } from './components/TabBar'

/** 窗控三键总宽 3u(每钮 1u):页签区右端比内容列右端短这么一截,对齐账里要补回来 */
export const WIN_CTL_U = 3
/** 按住位移阈值:超了才算拖,普通点按照旧走 onClick 激活页签 */
export const DRAG_START_PX = 4
/** 定向拆半屏的判定带:正文左右各 1/3 宽、全高都算数(产品定的手感:拖到三分之一就亮蓝) */
export const SPLIT_EDGE_THIRD = 1 / 3
/** 芯片松手后的淡出时长(拖出窗拆出新子窗那条路) */
export const CHIP_FADE_MS = 140
/** 沉降飞行时长:芯片飞回落点长成页签(与 CSS is-settle 的过渡时长对齐) */
export const CHIP_SETTLE_MS = 210

/** 拖拽芯片的生命周期:born=隐形量内容宽;enter=出生成原页签模样;
   drag=收成紧凑胶囊跟光标;settle=飞回落点长回页签(再把真身换上场) */
export type ChipPhase = 'born' | 'enter' | 'drag' | 'settle'

/** 沉降的落点矩形(视口坐标):芯片飞到这里长成页签 */
export interface SettleRect {
  left: number
  top: number
  width: number
  height: number
}

/** 拖拽芯片的呈现状态:替身长什么样、抓握偏移、跟到哪儿、是不是正在淡出 */
export interface TabDragState {
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
  /** 本组活序滑动的夹持边界(开拖时按本带快照记):首签左缘 ~ 末签右缘 */
  slideMinL: number
  slideMaxR: number
  phase: ChipPhase
  settle?: SettleRect
  leaving: boolean
  /** 指针已出窗且离开条带磁性带:松手就拆新窗,胶囊此时挂窗口预告样式 */
  willDetach: boolean
}

/** 跨窗落点的呈现账:目标窗 document 由 dragWindows 现查,这里只记局部坐标 */
export interface CrossTarget {
  host: string
  kind: 'strip' | 'body'
  /** 指针在目标窗里的局部坐标(芯片跟手用) */
  x: number
  y: number
  /** 条带落点:插入线的横坐标与中线 y */
  lineX: number | null
  lineY: number | null
  /** 正文落点:整块正文的局部矩形(亮边提示) */
  body: { left: number; top: number; width: number; height: number } | null
}

/** 当前落点:本窗页签带插队 / 本窗正文分屏 / 别窗条带 / 别窗正文 / 所有窗外 / 无处 */
export type DragZone =
  | { type: 'strip'; groupId: string; index: number }
  | { type: 'pane'; groupId: string; zone: 'left' | 'right' }
  | { type: 'host-strip'; host: string; groupId: string; index: number }
  | { type: 'host-body'; host: string; groupId: string | null }
  | { type: 'outside' }
  | { type: 'none' }

/** 本窗内的落点判定结果:落哪儿 + 缝开哪 + 正文亮哪边(空 = 都应撤掉) */
export interface LocalProbe {
  zone: DragZone
  gap: { groupId: string; index: number } | null
  dropMark: PaneDropMark | null
}

/** 跨窗的落点判定结果:落哪儿 + 目标窗里画什么提示(空 = 不画) */
export interface CrossProbe {
  zone: DragZone
  cross: CrossTarget | null
}

/** 拖拽开始时量到的源页签矩形(视口坐标) */
export interface SourceRect {
  left: number
  top: number
  right: number
  width: number
  height: number
}

/** 一次窗口矩形请求的回执类型(主进程给的无边框窗内容矩形) */
export type WindowRects = readonly AuxWindowRect[]

/** 页签拖拽会话对外露的状态与入口(实现在 useTabDragSession) */
export interface TabDragSession {
  drag: TabDragState | null
  gap: { groupId: string; index: number } | null
  cross: CrossTarget | null
  chipRef: React.RefObject<HTMLDivElement | null>
  beginTabDrag: (e: React.PointerEvent<HTMLDivElement>, t: TabBarTab) => void
  /** 被拖签的家在哪条带(null = 还没开拖) */
  dragSrcGroupId: string | null
  /** 活序滑动中真身亲自跟指针,替身胶囊退场 */
  chipHidden: boolean
}
