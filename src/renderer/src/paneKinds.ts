/**
 * 页签品类:一张页签要么是「文件签」(preview/peek —— 绑死某个文件的预览),
 * 要么是「单例签」(概览/小探针/图谱/设置 —— 全应用每品类只此一张)。
 * 页签不再跟树走、也没有钉住一说:文件签天生钉在自己的文件上,
 * 单例签由 rail/菜单入口开合,再点入口只聚焦不生第二张。
 */
export type PaneKind = 'overview' | 'chat' | 'preview' | 'graph' | 'settings' | 'peek' | 'uiframe'

/** 单例签的名牌户口(文件签的名/图标来自文件自己,不从这里领) */
export const KIND_LABELS: Record<PaneKind, string> = {
  overview: '概览',
  chat: '自由对话',
  preview: '文件预览',
  graph: '关系图谱',
  settings: '设置',
  peek: '预览',
  uiframe: 'UI 框架'
}

export const KIND_ICONS: Record<PaneKind, string> = {
  overview: 'navigation',
  chat: 'bot',
  preview: 'code',
  graph: 'view',
  settings: 'settings2',
  peek: 'code',
  uiframe: 'layoutTemplate'
}

/** 文件签品类:绑死一个文件(relPath + scopeRoot 定位),同一文件全应用只此一张 */
export function isFileKind(kind: PaneKind): boolean {
  return kind === 'preview' || kind === 'peek'
}

/** 单例签品类:全应用每品类只此一张,入口再点只聚焦 */
export function isSingletonKind(kind: PaneKind): boolean {
  return !isFileKind(kind)
}
