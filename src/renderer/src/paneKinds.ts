/**
 * 页签品类(小葵的页签模型):右栏的一张页签,要么是概览、要么是 Atlas 小探针(自由对话)、
 * 要么是文件预览 —— 一个文件/文件夹最多摊开这三张。以后出新功能页,这里加品类。
 * 判断「某节点能开哪几种页签」走两层过滤(小葵定的架构,别混一层):
 * 第一层 KIND_CAPS 按节点类型卡上限(文件有预览,文件夹/项目根没有);
 * 第二层 KINDS_KEY 的显示开关在上限里挑真正显示的 —— 以后加新节点类型只动第一层。
 */
import { readPref, writePref } from '../../shared/localPrefs.ts'

export type PaneKind = 'overview' | 'chat' | 'preview' | 'graph' | 'settings'

/** 品类的固定展示顺序(页签栏右键菜单从上到下按这个排)。
 *  注意:graph/settings 这类单例功能签不在菜单里 —— 它没有「勾显/隐藏」的说法,
 *  由 rail 入口直接开/聚焦(图谱本体还没造,先挂占位签;设置原弹窗退役改页签) */
export const KIND_ORDER: PaneKind[] = ['overview', 'chat', 'preview']

/** 品类菜单管不管得着它:菜单里的品类才有勾选开关;菜单外的(图谱等单例签)永远可见 */
export function isMenuKind(kind: PaneKind): boolean {
  return (KIND_ORDER as PaneKind[]).includes(kind)
}

export const KIND_LABELS: Record<PaneKind, string> = {
  overview: '概览',
  chat: 'Atlas 小探针',
  preview: '文件预览',
  graph: '关系图谱',
  settings: '设置'
}

/** 跟随页签的门面:页签栏挂品类名牌(装着谁看正文头部),图标从图标册领 */
export const KIND_ICONS: Record<PaneKind, string> = {
  overview: 'bulb',
  chat: 'bot',
  preview: 'code',
  graph: 'view',
  settings: 'settings2'
}

/** 第一层过滤:节点类型 → 可用品类上限 */
export const KIND_CAPS: Record<'file' | 'directory', PaneKind[]> = {
  file: ['overview', 'chat', 'preview'],
  directory: ['overview', 'chat']
}

/**
 * 跟随型品类:这些页签是「当前选中对象的常驻窗口」,勾着显示就该在栏上 ——
 * 被 × 掉了,树里一动就自动补回来(装着新对象)。文件预览是按需品类(双击/绿字才开),
 * 不在其列,被关了就安安静静等用户点名。
 */
export const FOLLOW_KINDS: PaneKind[] = ['overview', 'chat']

/** 第二层过滤:哪些品类勾选显示,记进本机(跨重启记住自己的勾法) */
const KINDS_KEY = 'atlas.pane-kinds'

export function loadEnabledKinds(): Set<PaneKind> {
  const list = readPref<string[] | null>(KINDS_KEY, null)
  // 存档坏了/是空名单就当没存过,回到出厂全开
  if (Array.isArray(list) && list.length > 0)
    return new Set(KIND_ORDER.filter((k) => list.includes(k)))
  return new Set(KIND_ORDER)
}

export function saveEnabledKinds(kinds: Set<PaneKind>): void {
  writePref(
    KINDS_KEY,
    KIND_ORDER.filter((k) => kinds.has(k))
  )
}
