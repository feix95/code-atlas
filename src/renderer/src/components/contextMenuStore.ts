/**
 * 通用右键菜单的状态仓(和 ContextMenu.tsx 分居:react-refresh 要求组件文件
 * 只导出组件)。模块级单例:全 app 同时最多一张菜单,谁要开只管报坐标和行项。
 * 文件路径专用那套在 filePathMenuStore,这里收「不是对着文件」的右键菜单(选区引用等)。
 */

/** 菜单里的一行:run 返回字符串的话,该行短暂亮出这句反馈再关闭(「已复制」那一挂) */
export interface ContextMenuItem {
  label: string
  /** 不可用的行摆着但点不动(比如引用额度满了,把原因写进 label) */
  disabled?: boolean
  /** 行内图标(TreeIcon 登记名):带图标档与纯图标档才摆,窄身文字档不带 */
  icon?: string
  /** 开关行:有值 = 行尾画一颗开关(true=开),点一下拨动且菜单不关闭,让人亲眼看到状态翻面;
   *  开关画面由菜单自己翻(各开关互相独立),run 只管把账改掉 */
  switchOn?: boolean
  /** 点了干啥;返回字符串 = 该行先亮这句话再关闭;返回 Promise 同理会等它。
   *  开关行会收到拨完之后的新读数(菜单不关闭可连拨,别用打开时抓的旧值取反) */
  run?: (nextOn?: boolean) => void | string | Promise<string | null | void>
  /** 二级列表:点了这行就地展开(菜单不关闭),子行点完才关闭 */
  children?: Array<{ label: string; run: () => void }>
}

/** 分区小标题:不可点的一行小灰字,告诉人下面几行是同一类东西 */
export interface ContextMenuHeading {
  heading: string
}

/** 组间细线记号:行项清单里插一条 = 两组之间画道分隔线(Obsidian 菜单分组) */
export const MENU_SEP = 'sep' as const
export type ContextMenuEntry = ContextMenuItem | ContextMenuHeading | typeof MENU_SEP

export function isMenuHeading(entry: ContextMenuEntry): entry is ContextMenuHeading {
  return typeof entry === 'object' && 'heading' in entry
}

export interface ContextMenuRequest {
  x: number
  y: number
  /** 菜单开在哪个 document(渲染域隔离):主窗和每个子窗各挂一台菜单,各认各的请求 */
  doc: Document
  items: ContextMenuEntry[]
  /** 窄身档:行项少的菜单(两三行)别按通用宽度撑开,贴着字宽摆 */
  compact?: boolean
  /** 纯图标档:方钮竖排,悬停整栏向右展开露出文字(输入框剪切复制粘贴全选) */
  iconOnly?: boolean
  /** 生在光标右上角(左缘约两个汉字、底缘一个汉字):输入框编辑菜单的顺手位 */
  preferRight?: boolean
  /** 整张菜单不挂任何悬停提示:行项、分区、二级行的浏览器原生 title 都不挂(图谱节点菜单用) */
  noTips?: boolean
}

let menuRequest: ContextMenuRequest | null = null
const listeners = new Set<() => void>()

/** 开菜单(在另一处再右键就挪到新位置) */
export function openContextMenu(request: ContextMenuRequest): void {
  menuRequest = request
  emit()
}

/** 关闭(点菜单外面 / 滚动 / Esc / 动作完的自动关,都走这儿) */
export function closeContextMenu(): void {
  menuRequest = null
  emit()
}

/** 给组件的订阅口:配 useSyncExternalStore 用 */
export function subscribeContextMenu(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function currentContextMenu(): ContextMenuRequest | null {
  return menuRequest
}

function emit(): void {
  listeners.forEach((l) => l())
}
