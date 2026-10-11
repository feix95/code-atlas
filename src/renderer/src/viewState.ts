// 页签看片状态:旧账本存的是三档单选(live/reading/source),界面上是两个独立开关
// 「排版显示」(仅 md 系有)×「只读」(所有文件都有)。这里是两边的唯一换算口。
//   live    = 排版开 + 可编辑      reading = 排版开 + 只读
//   source  = 排版关 + 可编辑      source + readOnly = 排版关 + 只读(纯文本只读)
// 代码文件没有排版这一维:viewMode 永远缺省,只读记在 readOnly 上。
import { canReadingMode, type PaneViewMode } from './paneTabs.ts'

/** 页签账本里与看片有关的两个字段 */
export interface TabView {
  viewMode?: PaneViewMode
  /** 只读的显式账:reading 档自带只读,不用它;source 档与代码文件靠它记「锁住了」 */
  readOnly?: boolean
}

export interface ViewFlags {
  /** 这个文件有没有排版可开(md 系才有) */
  canRender: boolean
  render: boolean
  readOnly: boolean
}

/** 一次拨动:没提到的那个开关保持原样 */
export interface ViewFlagsWant {
  render?: boolean
  readOnly?: boolean
}

/** 账本字段 → 界面两个开关的当前读数 */
export function viewFlags(relPath: string, tab: TabView): ViewFlags {
  const canRender = canReadingMode(relPath)
  const mode: PaneViewMode = canRender ? (tab.viewMode ?? 'live') : 'source'
  return {
    canRender,
    render: mode !== 'source',
    readOnly: mode === 'reading' || tab.readOnly === true
  }
}

/** 两个开关的目标读数 → 落账形态(每种组合只有一种存法);
    readOnly 键永远显式在场:调用方按浅合并落账,键不在 = 旧值原样留在签上
    (曾把锁焊死:解锁返回体没写 readOnly,旧 true 阴魂不散,菜单常蓝、编辑器拒字) */
function toTabView(canRender: boolean, render: boolean, readOnly: boolean): TabView {
  if (!canRender) return { viewMode: undefined, readOnly: readOnly || undefined }
  if (render) return { viewMode: readOnly ? 'reading' : 'live', readOnly: undefined }
  return { viewMode: 'source', readOnly: readOnly || undefined }
}

/** 拨一个或两个开关:没提到的那个保持原样;代码文件的排版请求直接忽略 */
export function applyViewFlags(relPath: string, tab: TabView, want: ViewFlagsWant): TabView {
  const now = viewFlags(relPath, tab)
  return toTabView(now.canRender, want.render ?? now.render, want.readOnly ?? now.readOnly)
}
