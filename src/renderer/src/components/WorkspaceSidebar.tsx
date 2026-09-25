// 资源管理器式左栏(UI v3 第 2 层 · 常驻):workspace 栏(路径输入,未来的地址栏卡槽位)
// + 文件树 + 扫描状态脚栏,右缘一条可拖分割条。
// 规格 §7.1「不存在空侧栏」:没开工作区时树区 = 「这台电脑」盘符列表;
// 现在的盘符行单击即开,B8 换成资源管理器语义(单击原地展开、双击开为工作区)。
// 「项目导览」钮按规格摘除:导览内容 = 概览页签的零状态,入口挪进 rail。
import type { DriveInfo, ScanDirNode, ScanFileNode, ScanResult } from '@shared/types'
import type { NoteMap } from '@shared/notes'
import { isTreePartial } from '@shared/scanCoverage'
import { driveCapacity, driveKindName } from '../driveMeta'
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
  treeNote,
  filter,
  folder,
  scanning,
  pathDraft,
  pathHint,
  pathShaking,
  pathInputRef,
  setPathDraft,
  dismissPathHint,
  goPath,
  setPathShaking,
  goHome,
  sidebarWidth,
  onSashPointerDown,
  onSashPointerMove,
  endSashDrag,
  onSashDoubleClick,
  onSashKeyDown,
  drives,
  drivesNote,
  onOpenDrive
}: {
  /** null = 没开工作区:树区换成「这台电脑」盘符列表(§7.1 空态) */
  result: ScanResult | null
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
  treeNote: string | null
  /** 顶栏搜索框的过滤词(B1 先走旧的树内过滤,深搜在 B7) */
  filter: string
  folder: string | null
  scanning: boolean
  pathDraft: string
  pathHint: string | null
  pathShaking: boolean
  pathInputRef: React.RefObject<HTMLInputElement | null>
  setPathDraft: React.Dispatch<React.SetStateAction<string>>
  dismissPathHint: () => void
  goPath: () => Promise<void>
  setPathShaking: React.Dispatch<React.SetStateAction<boolean>>
  goHome: () => void
  sidebarWidth: number
  onSashPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onSashPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  endSashDrag: (e: React.PointerEvent<HTMLDivElement>) => void
  onSashDoubleClick: () => void
  onSashKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  /** 「这台电脑」空态:盘符列表与加载/失败消息(App 首页同款数据源) */
  drives: DriveInfo[] | null
  drivesNote: string | null
  onOpenDrive: (path: string) => void
}): React.JSX.Element {
  return (
    <>
      {/* 宽度吃 .app 上的 --sidebar-w(顶栏左段同认它,分界线上行段才对得齐);
          rem 值由 App 按 基准宽/(16×uiScale) 算好挂进 CSS 变量,坐标系只有一套 */}
      <aside className="sidebar" style={{ width: 'var(--sidebar-w)' }}>
        {/* workspace 栏 = 路径输入栏(§7.0):回车开路径;右端 ⌂ 回「这台电脑」
            是 B1 过渡件,B5 换成地址栏式卡 + ⇅ 菜单 */}
        <div className="sidebar-top">
          <div
            className={`ws-card${pathShaking ? ' is-shaking' : ''}`}
            onAnimationEnd={() => setPathShaking(false)}
          >
            <input
              ref={pathInputRef}
              className="ws-path"
              type="text"
              value={pathDraft}
              placeholder={folder ? '文件夹路径,回车直接打开' : '这台电脑'}
              disabled={scanning}
              spellCheck={false}
              aria-label="文件夹路径"
              onChange={(e) => {
                setPathDraft(e.target.value)
                dismissPathHint()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void goPath()
                if (e.key === 'Escape') setPathDraft(folder ?? '')
              }}
            />
            <button
              type="button"
              className="tb-btn ws-home"
              onClick={goHome}
              disabled={!folder || scanning}
              title="回到「这台电脑」"
              aria-label="回到「这台电脑」"
            >
              <TreeIcon name="home" size={18} mono />
            </button>
            {pathHint && (
              <div className="path-hint" role="status">
                {pathHint}
              </div>
            )}
          </div>
        </div>
        {result ? (
          <FileTree
            root={result.tree}
            rootPath={result.rootPath}
            notes={notes}
            selectedPath={selectedFile?.relPath ?? selectedFolder?.relPath ?? null}
            expandingPath={expanding}
            revealPaths={revealPaths}
            filter={filter}
            onSelectFile={(_relPath, file) => followFile(file)}
            onSelectFolder={followDir}
            onExpandLazy={(relPath) => void handleExpandLazy(relPath)}
            onNoteEdit={editNoteFromTree}
            onNoteRemove={(relPath) => saveNote(relPath, '')}
            onPreviewFile={openPreview}
          />
        ) : (
          /* 「这台电脑」空态(§7.1):盘符列表,B8 升级成可下钻的树 */
          <div className="drive-browser">
            {drives === null && !drivesNote ? (
              <p className="drive-browser-note">正在列盘符……</p>
            ) : drivesNote ? (
              <p className="drive-browser-note">{drivesNote}</p>
            ) : (
              <ul>
                {(drives ?? []).map((d) => (
                  <li key={d.letter}>
                    <button
                      type="button"
                      className="drive-row"
                      disabled={scanning}
                      onClick={() => onOpenDrive(d.letter)}
                    >
                      <TreeIcon name="drive" size={16} mono />
                      <span className="drive-row-letter">{d.letter}:\</span>
                      <span className="drive-row-meta">
                        {driveKindName(d)} · {driveCapacity(d)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {result && (
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
        )}
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
