// 往对话面板里拖东西:内里的引用/文件节点、系统拖来的文件(Files)三条路各归各筐。
import { useState } from 'react'
import { isImageFile } from '@shared/fileKinds'
import {
  DRAG_MIME_NODE,
  DRAG_MIME_REF,
  type DragNodePayload,
  type DragRefPayload
} from '@shared/dragTypes'
import type { ChatCodeRef } from '@shared/types'
import { partitionAttachFiles, type useChatFiles } from './useChatFiles'
import type { useChatImages } from './useChatImages'
import type { AiChatApi } from './useAiChat'

export function useChatDrop(deps: {
  /** 拖来的文件读盘走 rootPath:树里拖文件当附件读原文 */
  rootPath?: string
  /** 预览里选中的一段拖进来挂引用(正文自包含,不用读盘) */
  onDropRef?: (ref: ChatCodeRef) => void
  chat: AiChatApi
  chatImages: ReturnType<typeof useChatImages>
  chatFiles: ReturnType<typeof useChatFiles>
}): {
  dragOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
} {
  const { rootPath, onDropRef, chat, chatImages, chatFiles } = deps
  // 拖拽悬停的亮框提示:松手就挂上,不用文案教
  const [dragOver, setDragOver] = useState(false)

  function onDragOver(e: React.DragEvent): void {
    const types = e.dataTransfer.types
    // 三种货都接:内里的引用/文件节点照旧,系统拖来的文件(Files)是附件那条路
    const accept =
      (rootPath !== undefined && types.includes(DRAG_MIME_NODE)) ||
      (onDropRef !== undefined && types.includes(DRAG_MIME_REF)) ||
      types.includes('Files')
    if (!accept) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  function onDragLeave(e: React.DragEvent): void {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }

  function onDrop(e: React.DragEvent): void {
    setDragOver(false)
    // 先认选段(自带正文):预览里选中一段拖过来的,直接挂引用不用读盘
    const rawRef = e.dataTransfer.getData(DRAG_MIME_REF)
    if (rawRef && onDropRef) {
      e.preventDefault()
      try {
        const ref = JSON.parse(rawRef) as DragRefPayload
        if (ref.relPath && ref.code) onDropRef(ref)
      } catch {
        // 不是咱家的货,不接
      }
      return
    }
    const raw = e.dataTransfer.getData(DRAG_MIME_NODE)
    if (raw && rootPath !== undefined) {
      e.preventDefault()
      try {
        const node = JSON.parse(raw) as DragNodePayload
        if (node.kind === 'folder') {
          chat.note('文件夹带不进来——点开它,把里面的文件拖进来就行')
          return
        }
        if (!node.relPath) return
        const name = node.relPath.split('/').pop() ?? node.relPath
        // 拖拽分流(对齐 Claude Code 的 @文件):图片走图片链;
        // 其余文本文件当文件附件读原文(读不了的由状态表自己垫灰字)
        if (isImageFile(name)) void chatImages.addFromRelPath(rootPath, node.relPath)
        else void chatFiles.addFromRelPath(rootPath, node.relPath)
      } catch {
        // 不是咱家的货,不接
      }
      return
    }
    // 系统拖来的文件:按类分流 —— 图片进待发图,其余当文件附件读原文
    const dropped = Array.from(e.dataTransfer.files ?? [])
    if (dropped.length === 0) return
    e.preventDefault()
    const parts = partitionAttachFiles(dropped)
    if (parts.images.length > 0) void chatImages.addFiles(parts.images)
    if (parts.files.length > 0) void chatFiles.addFiles(parts.files)
  }

  return { dragOver, onDragOver, onDragLeave, onDrop }
}
