// 资源管理器式左栏:项目导览 + 文件树 + 扫描状态脚栏,右缘一条可拖分割条。
import type { ScanDirNode, ScanFileNode, ScanResult } from '@shared/types'
import type { NoteMap } from '@shared/notes'
import { ROOT_FONT_BASE_PX } from '@shared/uiScale'
import { isTreePartial } from '@shared/scanCoverage'
import { MIN_SIDEBAR_WIDTH } from '../useSidebarSash'
import { FileTree } from './FileTree'
import { TreeIcon } from './Icons'

export function WorkspaceSidebar({
  result,
  notes,
  selectedFile,
  selectedFolder,
  expanding,
  revealPaths,
  followFile,
  followDir,
  handleExpandLazy,
  editNoteFromTree,
  saveNote,
  openPreview,
  showProjectGuide,
  treeNote,
  sidebarWidth,
  uiScale,
  onSashPointerDown,
  onSashPointerMove,
  endSashDrag,
  onSashDoubleClick,
  onSashKeyDown
}: {
  result: ScanResult
  notes: NoteMap
  selectedFile: ScanFileNode | null
  selectedFolder: ScanDirNode | null
  expanding: string | null
  revealPaths: Set<string>
  followFile: (file: ScanFileNode) => Promise<void>
  followDir: (node: ScanDirNode) => void
  handleExpandLazy: (relPath: string) => Promise<void>
  editNoteFromTree: (relPath: string) => void
  saveNote: (relPath: string, text: string) => void
  openPreview: (relPath: string) => void
  showProjectGuide: () => void
  treeNote: string | null
  sidebarWidth: number
  uiScale: number
  onSashPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onSashPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  endSashDrag: (e: React.PointerEvent<HTMLDivElement>) => void
  onSashDoubleClick: () => void
  onSashKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
}): React.JSX.Element {
  return (
    <>
      {/* 宽度渲染成 rem 交给根字号缩放:rem 值 = 基准宽/16,根字号一动面板自动等比,
      不再自己乘系数画像素 —— 坐标系只有一套,鼠标判定和视觉永远重合 */}
      <aside
        className="sidebar"
        style={{ width: `${(sidebarWidth / (ROOT_FONT_BASE_PX * uiScale)).toFixed(4)}rem` }}
      >
        {/* 页签地基后树常驻左栏:预览搬进右栏页签,左栏不再整扇换装(点绿字闪一下的老病根就地拔除) */}
        <button type="button" className="workspace-home" onClick={showProjectGuide}>
          <TreeIcon name="bulb" />
          项目导览
        </button>
        <FileTree
          root={result.tree}
          rootPath={result.rootPath}
          notes={notes}
          selectedPath={selectedFile?.relPath ?? selectedFolder?.relPath ?? null}
          expandingPath={expanding}
          revealPaths={revealPaths}
          onSelectFile={(_relPath, file) => followFile(file)}
          onSelectFolder={followDir}
          onExpandLazy={(relPath) => void handleExpandLazy(relPath)}
          onNoteEdit={editNoteFromTree}
          onNoteRemove={(relPath) => saveNote(relPath, '')}
          onPreviewFile={openPreview}
        />
        <footer className="sidebar-footer">
          <span>
            <i
              className={`status-dot${isTreePartial(result.tree) ? ' is-amber' : ''}`}
              aria-hidden="true"
            />
            {isTreePartial(result.tree) ? '部分已扫描' : '扫描完成'}
          </span>
          <span className="mono">
            {result.stats.fileCount} 个文件 · {result.stats.dirCount} 个文件夹
          </span>
        </footer>
        {treeNote && (
          <div className="tree-toast" role="alert">
            {treeNote}
          </div>
        )}
      </aside>
      <div
        className="sash"
        role="separator"
        aria-orientation="vertical"
        aria-label="左右栏分割条:拖动调整左栏宽度,双击恢复默认"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuenow={Math.round(sidebarWidth)}
        tabIndex={0}
        onPointerDown={onSashPointerDown}
        onPointerMove={onSashPointerMove}
        onPointerUp={endSashDrag}
        onPointerCancel={endSashDrag}
        onDoubleClick={onSashDoubleClick}
        onKeyDown={onSashKeyDown}
      />
    </>
  )
}
