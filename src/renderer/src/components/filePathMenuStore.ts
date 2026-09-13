/**
 * 文件路径右键菜单的状态仓(和 FilePathMenu.tsx 分居:react-refresh 要求组件文件
 * 只导出组件)。模块级单例:全 app 同时最多一张菜单,链接按钮只管喊「开」。
 */

/** 菜单打开时要带的行李:鼠标位置 + 规范 relPath + 复制动作(App 层提供,带扫描根) */
export interface FilePathMenuRequest {
  x: number
  y: number
  relPath: string
  /** 复制成功返回绝对路径;失败返回 null(菜单里说人话,不弹错误框) */
  copy: () => Promise<string | null>
}

let menuRequest: FilePathMenuRequest | null = null
const listeners = new Set<() => void>()

/** 各处链接按钮的右键入口:开菜单(在另一处再右键就挪到新位置) */
export function openFilePathMenu(request: FilePathMenuRequest): void {
  menuRequest = request
  emit()
}

/** 收摊(点菜单外面 / 滚动 / Esc / 复制完的自动关,都走这儿) */
export function closeFilePathMenu(): void {
  menuRequest = null
  emit()
}

/** 给组件的订阅口:配 useSyncExternalStore 用 */
export function subscribeFilePathMenu(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function currentFilePathMenu(): FilePathMenuRequest | null {
  return menuRequest
}

function emit(): void {
  listeners.forEach((l) => l())
}
