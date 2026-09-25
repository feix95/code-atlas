/**
 * 拖拽暗号总账(P1-19):dataTransfer 的 MIME 名和载荷形状只许在这登记 ——
 * 拖出方(FileTree)和接收方(FreeChatPanel/App)对的是同一份暗号,
 * 写错一个字符拖拽就静默死(浏览器不报错),一处登记两头都引。
 * 页签拖拽不走这条:TopBarTabs 的 pointer 引擎直接管,没有 dataTransfer。
 */

/** 树节点(文件/文件夹)拖进聊天面板当资料 */
export const DRAG_MIME_NODE = 'application/x-atlas-node'

/** 树节点载荷:kind 告诉接收方按文件还是文件夹建资料附件 */
export interface DragNodePayload {
  kind: 'file' | 'folder'
  relPath: string
}
