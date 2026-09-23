// 右栏页签的户口本:页签/页签组两个账本格式,发号器与比例夹子。
import type { PaneKind } from './paneKinds'
import type { ChatMessage } from './useAiChat'

/**
 * 右栏页签(小葵的页签模型,2026-09-13 线框图定稿):
 * 页签分三个品类 —— 概览 / Atlas 小探针(自由对话) / 文件预览,品类能不能挂在某个节点上,
 * 由 paneKinds 的两层过滤管(先卡类型上限,再卡显示开关)。
 * 没钉的页签是「跟随页签」:左侧树点谁,它就换成谁的内容;每个品类同时只有一张在跟随。
 * 双击页签 = 钉住(pin):内容定在当时的节点上,树里换文件它不动,新文件的同品类额外新开一张。
 * 对话页签钉住 = 这场对话分家单过(记录搬给它,公用场清空重开)。
 */
export interface PaneTab {
  id: string
  kind: PaneKind
  /** 跟随页签=当前跟着的节点(每次跟随换装);钉住的=定死的节点。空串=项目主页/空槽 */
  relPath: string
  name: string
  icon: string
  pinned: boolean
  /** 对话页签钉住分家时的初始记录(保活面板挂载时吃掉,之后各长各的) */
  seed?: ChatMessage[]
}

/**
 * 页签组(积木式拼装):一组 = 一条页签栏 + 一块正文区,最多左右两组(小葵线框图的两栏),
 * 中间分割条拖比例。页签可以拖去另一组,组搬空了自己消亡。
 */
export interface PaneGroup {
  id: string
  tabs: PaneTab[]
  activeId: string | null
}

// 页签 id / 分组 id 共用一个发号器:页签身份跟内容走是两回事,跟随页签换装不换 id(聊天草稿不丢)
let tabSeq = 0
export function nextTabId(): string {
  tabSeq += 1
  return `tab:${tabSeq}`
}

export function clampPaneSplit(v: number): number {
  return Math.min(0.8, Math.max(0.2, v))
}
