// 文件预览的看片读数:界面上「排版显示」(仅 md 系有) × 「只读」(所有文件都有)两颗开关,
// 账本是 codePrefs 里的全局偏好(一拨全应用照办,新签与重启都继承,不关单签的事)。
// 这里只做 全局账 × 文件出身 → 界面读数 的换算,换算口只此一家,组件里不许另拼:
//   排版开 + 可编辑 = live      排版开 + 只读 = reading
//   排版关 + 可编辑 = source    排版关 + 只读 = 纯文本只读
// 非 md 文件没有排版这一维:render 恒为 false,只读照常生效。
import { canReadingMode } from './paneTabs.ts'
import {
  getPreviewReadOnly,
  getPreviewRender,
  setPreviewReadOnly,
  setPreviewRender,
  subscribePreviewReadOnly,
  subscribePreviewRender
} from './codePrefs.ts'

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

/** 当前读数快照(菜单开关行用):全局偏好过一遍 canRender 闸 */
export function viewFlags(relPath: string): ViewFlags {
  const canRender = canReadingMode(relPath)
  return {
    canRender,
    render: canRender ? getPreviewRender() : false,
    readOnly: getPreviewReadOnly()
  }
}

/** React 订阅口:两颗开关的合体听写,任何一颗翻了都喊醒订阅者(预览签就地重渲) */
export function subscribeViewFlags(fn: () => void): () => void {
  const offRender = subscribePreviewRender(fn)
  const offReadOnly = subscribePreviewReadOnly(fn)
  return () => {
    offRender()
    offReadOnly()
  }
}

/** useSyncExternalStore 的稳定快照:两开关压成一个数,变才重渲 */
export function getViewFlagsBits(): number {
  return (getPreviewRender() ? 1 : 0) | (getPreviewReadOnly() ? 2 : 0)
}

/** 拨开关的唯一写口:落全局偏好并广播,所有已开的签跟着翻面 */
export function applyViewFlags(want: ViewFlagsWant): void {
  if (want.render !== undefined) setPreviewRender(want.render)
  if (want.readOnly !== undefined) setPreviewReadOnly(want.readOnly)
}
