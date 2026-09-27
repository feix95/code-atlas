// 右栏页签的户口本:页签/页签组两个账本格式,发号器与比例夹子。
import type { PaneKind } from './paneKinds'

/**
 * 右栏页签(小葵的页签模型·文件签版):
 * 树里点文件 = 开一张绑死那个文件的文件签(装文件预览),同一文件全应用只此一张;
 * 概览/小探针/图谱/设置是单例签,每品类全应用只此一张,rail/菜单入口开合。
 * 没有跟随、没有钉住:页签代表的就是它自己那份内容。
 */
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

// 页签 id / 分组 id 共用一个发号器
let tabSeq = 0
export function nextTabId(): string {
  tabSeq += 1
  return `tab:${tabSeq}`
}

export function clampPaneSplit(v: number): number {
  return Math.min(0.8, Math.max(0.2, v))
}
