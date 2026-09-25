// 资源管理器式左栏(UI v3 第 2 层 · 常驻):workspace 栏(地址栏式卡 + ⇅ 菜单)
// + 文件树 + 扫描状态脚栏,右缘一条可拖分割条。
// 规格 §7.1「不存在空侧栏」:没开工作区时树区 = 「这台电脑」盘符列表;
// 现在的盘符行单击即开,B8 换成资源管理器语义(单击原地展开、双击开为工作区)。
// 「项目导览」钮按规格摘除:导览内容 = 概览页签的零状态,入口挪进 rail。
import { useEffect, useState } from 'react'
import type { DriveInfo, ScanDirNode, ScanFileNode, ScanResult } from '@shared/types'
import type { NoteMap } from '@shared/notes'
import type { SearchNameHit } from '@shared/searchNames'
import { isTreePartial } from '@shared/scanCoverage'
import { menuWorkspaceRows, type RecentProject } from '../recents'
import { useMenuDismiss } from '../useMenuDismiss'
import { MIN_SIDEBAR_WIDTH } from '../useSidebarSash'
import { DriveBrowser } from './DriveBrowser'
import { FileTree } from './FileTree'
import { TreeIcon } from './Icons'
import { SearchResults } from './SearchResults'
import { WorkspaceMenu } from './WorkspaceMenu'

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
  search,
  onOpenSearchFile,
  onOpenSearchDir,
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
  recents,
  onOpenWorkspace,
  onTogglePin,
  onRemoveRecent,
  sidebarWidth,
  onSashPointerDown,
  onSashPointerMove,
  endSashDrag,
  onSashDoubleClick,
  onSashKeyDown,
  drives,
  drivesNote,
  onOpenBrowseFile
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
  handleExpandLazy: (relPath: string) => Promise<ScanDirNode | null>
  editNoteFromTree: (relPath: string) => void
  saveNote: (relPath: string, text: string) => void
  openPreview: (relPath: string) => void
  treeNote: string | null
  /** 顶栏搜索词的深搜账本(UI v3 §7.2):非 null = 树区整体换成结果清单;
      null = 没词/没工作区,文件树原样站岗 */
  search: {
    q: string
    hits: SearchNameHit[]
    searching: boolean
    truncated: boolean
    stoppedEarly: boolean
  } | null
  /** 文件命中:探开父链再开预览页签(App 的 openSearchFile) */
  onOpenSearchFile: (hit: SearchNameHit) => void
  /** 文件夹命中:打开为工作区(§7.2 给定) */
  onOpenSearchDir: (hit: SearchNameHit) => void
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
  /** 工作区菜单(§7.1):recents 账本原样进,菜单内部分 pin/历史两区 */
  recents: RecentProject[]
  /** 菜单里点条目:直接进入该工作区(= 输路径回车的同一动作) */
  onOpenWorkspace: (path: string) => void
  /** 行首 pin 钮:pin ↔ unpin,账本在 App 层写 */
  onTogglePin: (path: string) => void
  /** 行尾 × 即删(无撤销) */
  onRemoveRecent: (path: string) => void
  sidebarWidth: number
  onSashPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onSashPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  endSashDrag: (e: React.PointerEvent<HTMLDivElement>) => void
  onSashDoubleClick: () => void
  onSashKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  /** 「这台电脑」空态:盘符列表与加载/失败消息(App 首页同款数据源) */
  drives: DriveInfo[] | null
  drivesNote: string | null
  /** 浏览态单击文件:开「瞄一眼」预览页签(scopeRoot = 浏览树的盘根) */
  onOpenBrowseFile: (scopeRoot: string, file: { name: string; relPath: string }) => void
}): React.JSX.Element {
  // ── workspace 卡 = 浏览器地址栏(§7.0):点卡任意处 = 聚焦输入框 + 弹出菜单;
  //    ⇅ 钮开/收;Esc / 点外 / 选中条目 = 收(useMenuDismiss 管外面,键盘管里面)
  const [menuOpen, setMenuOpen] = useState(false)
  // 键盘高亮行号:-1 = 还没动过方向键,Enter 还按「输入的路径」走;按下箭头才开始挑条目
  const [menuHi, setMenuHi] = useState(-1)
  const sections = menuWorkspaceRows(recents)
  const flatRows = [...sections.pinned, ...sections.history]
  useMenuDismiss(menuOpen, () => setMenuOpen(false), '.sidebar-top')

  // 键盘高亮的行滚进视野(菜单超 5 条内部滚动,高亮行可能躲在视口外)
  useEffect(() => {
    if (!menuOpen || menuHi < 0) return
    document.querySelector('.ws-menu .wsm-row.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [menuOpen, menuHi])

  function openMenu(): void {
    setMenuHi(-1)
    setMenuOpen(true)
  }

  function enterMenuRow(i: number): void {
    const row = flatRows[i]
    if (!row) return
    setMenuOpen(false)
    setMenuHi(-1)
    onOpenWorkspace(row.p)
  }

  // 路径输入框里的菜单按键:↑↓ 移动高亮,Enter 进高亮条目(没高亮就照旧开路径)
  function onCardKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (menuOpen && e.key === 'ArrowDown') {
      e.preventDefault()
      if (flatRows.length > 0) setMenuHi((hi) => (hi + 1) % flatRows.length)
      return
    }
    if (menuOpen && e.key === 'ArrowUp') {
      e.preventDefault()
      if (flatRows.length > 0) setMenuHi((hi) => (hi <= 0 ? flatRows.length - 1 : hi - 1))
      return
    }
    if (e.key === 'Enter') {
      if (menuOpen && menuHi >= 0 && menuHi < flatRows.length) enterMenuRow(menuHi)
      else void goPath()
      return
    }
    if (e.key === 'Escape') setPathDraft(folder ?? '')
  }
  return (
    <>
      {/* 宽度吃 .app 上的 --sidebar-w(顶栏左段同认它,分界线上行段才对得齐);
          rem 值由 App 按 基准宽/(16×uiScale) 算好挂进 CSS 变量,坐标系只有一套 */}
      <aside className="sidebar" style={{ width: 'var(--sidebar-w)' }}>
        {/* workspace 栏 = 地址栏式卡(§7.0):点卡任意处 = 聚焦输入框 + 弹出菜单;
            ⇅ 钮开/收两态,菜单浮层盖在文件树上(不推挤布局、宽与卡同宽) */}
        <div className="sidebar-top">
          <div
            className={`ws-card${pathShaking ? ' is-shaking' : ''}${menuOpen ? ' is-menu-open' : ''}`}
            onAnimationEnd={() => setPathShaking(false)}
            onClick={() => {
              pathInputRef.current?.focus()
              openMenu()
            }}
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
              onKeyDown={onCardKeyDown}
            />
            <button
              type="button"
              className="tb-btn ws-menu-btn"
              disabled={scanning}
              title={menuOpen ? '收起工作区菜单' : '展开工作区菜单'}
              aria-label={menuOpen ? '收起工作区菜单' : '展开工作区菜单'}
              aria-expanded={menuOpen}
              onClick={(e) => {
                // 点卡 = 开菜单的地址栏手感,⇅ 是明确的开关 —— 阻止冒泡别让卡的开抢戏
                e.stopPropagation()
                if (menuOpen) setMenuOpen(false)
                else openMenu()
              }}
            >
              <TreeIcon name={menuOpen ? 'chevronsDownUp' : 'chevronsUpDown'} size={15} mono />
            </button>
            {pathHint && !menuOpen && (
              <div className="path-hint" role="status">
                {pathHint}
              </div>
            )}
            {menuOpen && (
              <WorkspaceMenu
                pinned={sections.pinned}
                history={sections.history}
                highlight={menuHi}
                onOpen={(p) => {
                  setMenuOpen(false)
                  setMenuHi(-1)
                  onOpenWorkspace(p)
                }}
                onTogglePin={onTogglePin}
                onRemove={onRemoveRecent}
              />
            )}
          </div>
        </div>
        {result ? (
          // §7.2:搜索词非空 = 树区整体换成深搜清单;清空词,文件树原样回来
          search ? (
            <SearchResults
              query={search.q}
              hits={search.hits}
              searching={search.searching}
              truncated={search.truncated}
              stoppedEarly={search.stoppedEarly}
              onOpenFile={onOpenSearchFile}
              onOpenDir={onOpenSearchDir}
            />
          ) : (
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
          )
        ) : (
          /* 「这台电脑」空态(§7.1):盘符列表可下钻 —— 单击原地展开,
             双击开为工作区,单击文件开预览页签 */
          <DriveBrowser
            drives={drives}
            drivesNote={drivesNote}
            onOpenWorkspace={onOpenWorkspace}
            onOpenFile={onOpenBrowseFile}
          />
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
