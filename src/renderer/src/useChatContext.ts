// 公用场的聊天上下文:跟着选中的文件/文件夹走;什么都没选就聊项目根 —— 探针随时都在,不挑时候。
import { useMemo } from 'react'
import type { FileStructure, ScanDirNode, ScanFileNode, ScanResult } from '@shared/types'
import { buildFileAttachment, buildFolderAttachment } from './chatContext'

export function useChatContext(deps: {
  result: ScanResult | null
  selectedFile: ScanFileNode | null
  selectedFolder: ScanDirNode | null
  structure: FileStructure | null
}): ReturnType<typeof buildFolderAttachment> | null {
  const { result, selectedFile, selectedFolder, structure } = deps
  return useMemo(() => {
    if (!result) return null
    if (selectedFile) return buildFileAttachment(selectedFile, structure)
    if (selectedFolder)
      return buildFolderAttachment(selectedFolder, selectedFolder.name || result.rootName)
    return buildFolderAttachment(result.tree, result.rootName)
  }, [result, selectedFile, selectedFolder, structure])
}
