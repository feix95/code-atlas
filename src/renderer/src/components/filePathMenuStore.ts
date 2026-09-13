/**
 * 文件路径右键菜单的状态仓(和 FilePathMenu.tsx 分居:react-refresh 要求组件文件
 * 只导出组件)。模块级单例:全 app 同时最多一张菜单,链接按钮只管喊「开」。
 */

/** 备注系列动作(菜单统一大锤,小葵拍的:对着文件右键 = 复制路径/资源管理器/写备注三件套):
 *  树菜单、聊天绿字链接、预览器头部文件名,一处规格三家共用 */
export interface FilePathNoteActions {
  hasNote: boolean
  /** 写/编辑备注:App 侧负责选中节点 + 弹详情页的编辑框 */
  onEdit: () => void
  /** 清除备注;不传就不摆这一项 */
  onRemove?: () => void
}

/** 菜单打开时要带的行李:鼠标位置 + 规范 relPath + 两个动作(都由 App 层提供,带扫描根) */
export interface FilePathMenuRequest {
  x: number
  y: number
  relPath: string
  /** 复制完整路径:成功返回绝对路径;失败返回 null(菜单里说人话,不弹错误框) */
  copy: () => Promise<string | null>
  /** 在文件资源管理器中显示:成功返回 null(资源管理器弹出本身就是反馈);
   *  失败返回要显示的人话(比如文件已经不在了) */
  reveal: () => Promise<string | null>
  /** 备注系列,可选:不传就只有两件带路的老两项 */
  note?: FilePathNoteActions
}

let menuRequest: FilePathMenuRequest | null = null
const listeners = new Set<() => void>()

/** 各处链接按钮的右键入口:开菜单(在另一处再右键就挪到新位置) */
export function openFilePathMenu(request: FilePathMenuRequest): void {
  menuRequest = request
  emit()
}

/**
 * 一站式开菜单:知道扫描根的调用方(聊天链接的 App 层、预览器头部)传 (rootPath, relPath)
 * 加鼠标坐标就行,复制/显现两个动作都在这儿接好,不用每处自己拼闭包;
 * 要备注三件套的再带上 note(树菜单是自绘的,不走这张)
 */
export function openFilePathMenuFor(
  rootPath: string,
  relPath: string,
  x: number,
  y: number,
  note?: FilePathNoteActions
): void {
  openFilePathMenu({
    x,
    y,
    relPath,
    copy: async () => {
      const r = await window.atlas.copyFilePath(rootPath, relPath)
      return r.ok && r.path !== undefined ? r.path : null
    },
    reveal: async () => {
      const r = await window.atlas.revealFilePath(rootPath, relPath)
      return r.ok ? null : (r.message ?? '没打开成')
    },
    note
  })
}

/** 收摊(点菜单外面 / 滚动 / Esc / 动作完的自动关,都走这儿) */
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
