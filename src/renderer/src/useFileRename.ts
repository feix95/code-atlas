// 内联标题改名(内联标题改名锤):主进程换完盘上户口,这边一排账全换新路径 ——
// 扫描树节点(换名重排)、文件签户口、选中态、备注、引用段,一次结清不丢账。
// 外来户(树/选中/备注/引用/页签账本)由调用方递进来,本体只是编排。
import { saveNotes, type NoteMap } from '@shared/notes'
import type { RenameOutcome } from '@shared/fileRename'
import type { ChatCodeRef, ScanFileNode, ScanResult } from '@shared/types'
import type { PaneTab } from './paneTabs'
import { renameFileNode } from './scanTreeTools'
import { cleanErrMsg } from './errText'

export function useFileRename(deps: {
  result: ScanResult | null
  selectedFile: ScanFileNode | null
  folder: string | null
  notes: NoteMap
  setResult: React.Dispatch<React.SetStateAction<ScanResult | null>>
  setSelectedFile: React.Dispatch<React.SetStateAction<ScanFileNode | null>>
  setNotes: React.Dispatch<React.SetStateAction<NoteMap>>
  setPreviewRefs: React.Dispatch<React.SetStateAction<ChatCodeRef[]>>
  renameFileTab: (
    scopeRoot: string | undefined,
    oldRelPath: string,
    newRelPath: string,
    newName: string
  ) => void
}): (tab: PaneTab, base: string) => Promise<RenameOutcome> {
  const {
    result,
    selectedFile,
    folder,
    notes,
    setResult,
    setSelectedFile,
    setNotes,
    setPreviewRefs,
    renameFileTab
  } = deps

  // 瞄签读根在浏览树(scopeRoot):树账不还、页签账照还;
  // 户口认 (relPath, scopeRoot) 两件,与开签对账同口径
  return async (tab, base) => {
    const scopeRoot = tab.kind === 'peek' ? tab.scopeRoot : (result?.rootPath ?? null)
    if (!scopeRoot) return { ok: false, error: '这个项目还没打开' }
    const oldRel = tab.relPath
    try {
      const r = await window.atlas.renameFile(scopeRoot, oldRel, base)
      if (result && !tab.scopeRoot) {
        const renamed = renameFileNode(result.tree, oldRel, r.name)
        if (renamed) {
          setResult({ ...result, tree: renamed.tree })
          if (selectedFile?.relPath === oldRel) setSelectedFile(renamed.node)
        }
      }
      renameFileTab(tab.scopeRoot, oldRel, r.relPath, r.name)
      if (notes[oldRel] !== undefined && folder) {
        setNotes((prev) => {
          const next = { ...prev, [r.relPath]: prev[oldRel] }
          delete next[oldRel]
          saveNotes(folder, next)
          return next
        })
      }
      setPreviewRefs((prev) =>
        prev.map((ref) => (ref.relPath === oldRel ? { ...ref, relPath: r.relPath } : ref))
      )
      return { ok: true, relPath: r.relPath, name: r.name }
    } catch (err) {
      return { ok: false, error: cleanErrMsg(err) }
    }
  }
}
