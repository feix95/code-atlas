/**
 * 通用右键菜单的状态仓(和 ContextMenu.tsx 分居:react-refresh 要求组件文件
 * 只导出组件)。模块级单例:全 app 同时最多一张菜单,谁要开只管报坐标和行项。
 * 文件路径专用那套在 filePathMenuStore,这里收「不是对着文件」的右键菜单(选区引用等)。
 */

/** 菜单里的一行:run 返回字符串的话,该行短暂亮出这句反馈再收摊(「已复制」那一挂) */
export interface ContextMenuItem {
  label: string
  /** 不可用的行摆着但点不动(比如引用额度满了,把原因写进 label) */
  disabled?: boolean
  /** 悬停轻提示(data-tip) */
  tip?: string
  /** 行内图标(TreeIcon 户口名):带图标档的菜单(Obsidian 式页签菜单)才摆,窄身档不带 */
  icon?: string
  /** 开关行:有值 = 行尾画一颗开关(true=开),点一下拨动且菜单不收摊,让人亲眼看到状态翻面;
   *  开关画面由菜单自己翻(各开关互相独立),run 只管把账改掉 */
  switchOn?: boolean
  /** 点了干啥;返回字符串 = 该行先亮这句话再收摊;返回 Promise 同理会等它。
   *  开关行会收到拨完之后的新读数(菜单不收摊可连拨,别用打开时抓的旧值取反) */
  run?: (nextOn?: boolean) => void | string | Promise<string | null | void>
  /** 二级列表:点了这行就地展开(菜单不收摊),子行点完才收摊 */
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
  /** 菜单开在哪个 document(realm 铁律):主窗和每个子窗各挂一台菜单,各认各的请求 */
  doc: Document
  items: ContextMenuEntry[]
  /** 窄身档:行项少的菜单(两三行)别按通用宽度撑开,贴着字宽摆 */
  compact?: boolean
  /** 生在光标正右侧(垂直居中对光标、左缘隔空一个汉字):贴着输入区的小菜单顺手位 */
  preferRight?: boolean
}

let menuRequest: ContextMenuRequest | null = null
const listeners = new Set<() => void>()

/** 开菜单(在另一处再右键就挪到新位置) */
export function openContextMenu(request: ContextMenuRequest): void {
  menuRequest = request
  emit()
}

/** 收摊(点菜单外面 / 滚动 / Esc / 动作完的自动关,都走这儿) */
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
