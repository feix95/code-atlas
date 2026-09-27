// 右栏页签的户口本:页签/页签组两个账本格式,发号器与比例夹子。
import type { PaneKind } from './paneKinds'

/**
 * 右栏页签(小葵的页签模型·文件签版):
 * 树里点文件 = 开一张绑死那个文件的文件签(装文件预览),同一文件全应用只此一张;
 * 概览/小探针/图谱/设置是单例签,每品类全应用只此一张,rail/菜单入口开合。
 * 没有跟随、没有钉住:页签代表的就是它自己那份内容。
 */
/** 文件签的看片档位(阅读模式这锤):source=源码(行号/分色/选区引用),reading=md 渲染态 */
export type PaneViewMode = 'source' | 'reading'

/** 能进阅读模式的后缀(md 系):别的文件没有「渲染态」,菜单里连选项都不摆 */
const READING_EXTS = new Set(['md', 'markdown', 'mdx'])

/** 这个文件能不能切阅读模式(纯函数):按后缀认,点在路径段上的点才算(目录名里的点不搅局) */
export function canReadingMode(relPath: string): boolean {
  const i = relPath.lastIndexOf('.')
  const sep = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'))
  return i > sep && READING_EXTS.has(relPath.slice(i + 1).toLowerCase())
}

export interface PaneTab {
  id: string
  kind: PaneKind
  /** 文件签 = 绑死的文件 relPath;单例签 = 空串(内容自理,概览跟着当前选中走) */
  relPath: string
  name: string
  icon: string
  /** 「瞄一眼」文件签(peek)的读根:盘符下钻不归工作区,
   *  CodePreview 读文件走 joinRoot(scopeRoot, relPath);工作区文件签不填 */
  scopeRoot?: string
  /** 文件签的看片档位(阅读模式这锤):undefined = 源码;记在签身上,拖窗/存档都跟着走 */
  viewMode?: PaneViewMode
}

/**
 * 页签组(积木式拼装):一组 = 一条页签栏 + 一块正文区,同一窗口内最多左右两组
 * (小葵线框图的两栏),中间分割条拖比例。页签可以拖去另一组,组搬空了自己消亡。
 */
export interface PaneGroup {
  id: string
  tabs: PaneTab[]
  activeId: string | null
  /** 寄居窗口(页签撕窗锤):undefined/'main' = 主窗;'aux-N' = 撕出去的子窗。
   *  户口挂组不挂签:组才是分屏/渲染单元,签的户口跟着它所在的组走;
   *  存档不落这个字段 —— 子窗布局不记,重开时子窗的签一律回主窗 */
  host?: string
}

/** 主窗户口名:host 缺省就是它(所有老账本/存档天然主窗) */
export const MAIN_HOST = 'main'

/** 组的寄居窗口名(纯函数):没填就是主窗 */
export function groupHost(g: PaneGroup): string {
  return g.host ?? MAIN_HOST
}

/** 某扇窗名下的组(纯函数):主窗/子窗各自画自己那条页签带和分屏 */
export function groupsForHost(groups: PaneGroup[], host: string): PaneGroup[] {
  return groups.filter((g) => groupHost(g) === host)
}

/**
 * 把页签挪进目标窗口的组(纯函数,撕窗的唯一换账通道):
 * 目标窗已有组就落第一组末尾,没有就现立;源组搬空自己消亡,激活指针落到新组。
 * 返回 null = 没找到这张签,账本原样。
 */
export function moveTabToHost(
  groups: PaneGroup[],
  tabId: string,
  host: string
): { groups: PaneGroup[]; activeGroupId: string } | null {
  const from = groups.find((g) => g.tabs.some((t) => t.id === tabId))
  if (!from) return null
  const next = groups.map((g) => ({ ...g, tabs: [...g.tabs] }))
  const src = next.find((g) => g.id === from.id)!
  const idx = src.tabs.findIndex((t) => t.id === tabId)
  const [moved] = src.tabs.splice(idx, 1)
  if (src.activeId === tabId) {
    src.activeId = src.tabs.length > 0 ? src.tabs[src.tabs.length - 1].id : null
  }
  let dst = next.find((g) => groupHost(g) === host && g.tabs.length > 0)
  if (!dst) {
    dst = { id: `pane:${nextTabId()}`, tabs: [], activeId: null, host }
    next.push(dst)
  }
  dst.tabs.push(moved)
  dst.activeId = moved.id
  dst.host = host
  // 搬空的组消亡(主窗拖空 = 回空底板,子窗拖空 = 子窗自动关,两边都不留死组)
  const kept = next.filter((g) => g.tabs.length > 0)
  return { groups: kept, activeGroupId: dst.id }
}

/** 某扇窗名下的组整窝清掉(纯函数):子窗被关 = 它名下的签连组一起销户 */
export function dropHostGroups(groups: PaneGroup[], host: string): PaneGroup[] {
  return groups.filter((g) => groupHost(g) !== host)
}

// 页签 id / 分组 id 共用一个发号器
let tabSeq = 0
export function nextTabId(): string {
  tabSeq += 1
  return `tab:${tabSeq}`
}

export function clampPaneSplit(v: number): number {
  return Math.min(0.8, Math.max(0.2, v))
}
