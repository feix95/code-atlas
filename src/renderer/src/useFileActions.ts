// 文件动作:树里点、深搜命中、图谱打开、页签回树,统一从这里进。
// 选中状态与结构分析结果归这里管;开签本体在页签系统,经 deps 递进来。
import { useRef, useState } from 'react'
import { canPreviewFile } from '@shared/fileKinds'
import type { SearchNameHit } from '@shared/searchNames'
import type { FileStructure, ScanDirNode, ScanFileNode, ScanResult } from '@shared/types'
import { PREVIEW_BLOCKED_MS, PREVIEW_BLOCKED_TEXT } from './appFeedback'
import type { NavLocation } from './navHistory'
import type { PaneGroup } from './paneTabs'
import { dirChainOf, findDir, findFile, spliceSubtree } from './scanTreeTools'

export function useFileActions(deps: {
  result: ScanResult | null
  folder: string | null
  pushNav: (loc: NavLocation) => void
  openFileTab: (file: ScanFileNode, scopeRoot?: string) => void
  showToast: (text: string, ms?: number) => void
  setRevealPaths: React.Dispatch<React.SetStateAction<Set<string>>>
  /** 分级扫描:探开一层目录(useLazyExpand 的 expandLazy) */
  expandLazy: (relPath: string) => Promise<ScanDirNode | null>
  /** 页签回树时要把侧栏掀开:树只在侧栏有 */
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
  groups: PaneGroup[]
}) {
  const {
    result,
    folder,
    pushNav,
    openFileTab,
    showToast,
    setRevealPaths,
    expandLazy,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    groups
  } = deps

  const [selectedFile, setSelectedFile] = useState<ScanFileNode | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<ScanDirNode | null>(null)
  const [structure, setStructure] = useState<FileStructure | null>(null)
  // 结构分析的票号:连点两个文件时,慢的旧响应回来不许盖新的账
  const analyzeSeq = useRef(0)

  /** 树里点文件:选中它 + 开一张绑死它的文件预览签(同一文件只此一张);不能预览的类型只选中 */
  function openFileTabIfPreviewable(file: ScanFileNode, scopeRoot?: string): void {
    if (!canPreviewFile(file.name)) {
      showToast(PREVIEW_BLOCKED_TEXT, PREVIEW_BLOCKED_MS)
      return
    }
    openFileTab(file, scopeRoot)
  }

  async function openFile(file: ScanFileNode): Promise<void> {
    const seq = ++analyzeSeq.current
    pushNav({ folder, file: file.relPath, dir: null })
    setSelectedFile(file)
    setSelectedFolder(null)
    setStructure(null)
    openFileTabIfPreviewable(file)
    if (result) setRevealPaths(new Set(dirChainOf(result.tree, file.relPath)))

    // 本地结构分析照旧自动跑(不耗模型):结果给自由对话附件当证据;失败静静放过
    if (!file.language) return
    try {
      // 路径契约:renderer 只回传 (rootPath, relPath),拼绝对路径是主进程的事
      if (!result) return
      const fs = await window.atlas.analyzeFile(result.rootPath, file.relPath, file.language.id)
      if (seq !== analyzeSeq.current) return // 用户已经点了别的文件,这份旧账作废
      if (fs) setStructure(fs)
    } catch {
      // 结构分析是锦上添花,失败不惊动界面
    }
  }

  // 树里点文件夹:只选中,不开页签 —— 箭头管展开,点名字不触发扫描
  function selectDir(node: ScanDirNode): void {
    analyzeSeq.current += 1
    if (node.relPath === '') {
      clearSelection()
      return
    }
    pushNav({ folder, file: null, dir: node.relPath })
    setSelectedFolder(node)
    setSelectedFile(null)
    setStructure(null)
    if (result) setRevealPaths(new Set(dirChainOf(result.tree, node.relPath)))
  }

  // 后退/前进回到「没选中」的一站:选中清空
  function clearSelection(): void {
    analyzeSeq.current += 1
    setSelectedFolder(null)
    setSelectedFile(null)
    setStructure(null)
  }

  // 「预览文件」入口(文件行右键/概览「查看文件内容」/图谱打开):选中 + 开文件签。
  // 文件已选中就只点亮签 —— 双击总伴着单击,别把导航账记重了
  function openPreview(relPath: string): void {
    if (!result) return
    const f = findFile(result.tree, relPath)
    if (!f) return
    if (selectedFile?.relPath !== relPath) void openFile(f)
    else openFileTabIfPreviewable(f)
  }

  // 页签右键「在文件列表中显示当前文件」:回侧栏树里选中它 + 展开父链滚过去;
  // 侧栏收着就先掀开 —— 定位的反馈只有看得见才算数。子窗里的签点这项,动的是主窗侧栏
  function revealTabInTree(id: string): void {
    if (!result) return
    const t = groups.flatMap((g) => g.tabs).find((x) => x.id === id)
    if (!t || t.kind !== 'preview' || t.relPath === '') return
    const f = findFile(result.tree, t.relPath)
    if (!f) return
    if (sidebarCollapsed) toggleSidebarCollapsed()
    setSelectedFile(f)
    setSelectedFolder(null)
    setRevealPaths(new Set(dirChainOf(result.tree, t.relPath)))
  }

  // 深搜的文件命中 = 开预览页签。命中的文件可能住在「还没探」的目录里:
  // 沿父链逐层探开,链探完节点就进树了;链上有探不开的也只是预览兜底说句实话
  async function openSearchFile(hit: SearchNameHit): Promise<void> {
    if (!result) return
    let tree = result.tree
    const parts = hit.relPath.split('/')
    for (let i = 0; i < parts.length - 1; i++) {
      const dirRel = parts.slice(0, i + 1).join('/')
      const node = findDir(tree, dirRel)
      if (!node) break // 父链在状态表上断了:探不动了,剩下的交给预览兜底说实话
      if (!node.lazy) continue
      const sub = await expandLazy(dirRel)
      if (!sub) return // 探这一层失败了:treeNote 已挂实话,不再往下硬闯
      tree = spliceSubtree(tree, dirRel, sub)
    }
    openPreview(hit.relPath)
  }

  // 「这台电脑」下钻单击文件 = 「瞄一眼」文件签(peek 品类):读根记在页签的 scopeRoot 上
  function openBrowseFile(scopeRoot: string, file: { name: string; relPath: string }): void {
    const dot = file.name.lastIndexOf('.')
    openFileTabIfPreviewable(
      {
        type: 'file',
        name: file.name,
        relPath: file.relPath,
        ext: dot > 0 ? file.name.slice(dot).toLowerCase() : ''
      },
      scopeRoot
    )
  }

  return {
    selectedFile,
    selectedFolder,
    setSelectedFile,
    setSelectedFolder,
    structure,
    clearSelection,
    openFile,
    selectDir,
    openPreview,
    revealTabInTree,
    openSearchFile,
    openBrowseFile
  }
}
