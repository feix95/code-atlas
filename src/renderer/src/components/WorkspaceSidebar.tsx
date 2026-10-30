// 资源管理器式左栏(UI v3 第 2 层 · 常驻):workspace 栏(地址栏式卡 + ⇅ 菜单)
// + 文件树 + 扫描状态脚栏,右缘一条可拖分割条。
// 规格 §7.1「不存在空侧栏」:没开工作区时树区 = 「这台电脑」盘符列表;
// 现在的盘符行单击即开,B8 换成资源管理器语义(单击原地展开、双击开为工作区)。
// 「项目导览」钮按规格摘除:导览内容 = 概览页签的零状态,入口挪进 rail。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DriveInfo, ScanDirNode, ScanFileNode, ScanResult } from '@shared/types'
import type { NoteMap } from '@shared/notes'
import type { SearchNameHit } from '@shared/searchNames'
import { ROOT_FONT_BASE_PX } from '@shared/uiScale'
import type { RecentProject } from '../recents'
import { MIN_SIDEBAR_WIDTH } from '../useSidebarSash'
import { readNotesShown, writeNotesShown } from '../treePrefs'
import { DriveBrowser } from './DriveBrowser'
import { FileTree } from './FileTree'
import { SearchResults } from './SearchResults'
import { WorkspacePathCard } from './WorkspacePathCard'
import { NoteToggleIcon, TreeIcon } from './Icons'
import { NAV_ICON_SIZE, NAV_ITEMS, type SectionKey } from '../settingsNav'
import type { SidebarFace } from '../useSettingsNav'
import {
  getSidebarDockState,
  setSidebarDockHost,
  setSidebarDockHostUsable,
  setSidebarDockSlot,
  subscribeSidebarDock
} from '../sidebarDock'
import { SidebarOutline } from './SidebarOutline'
import { UiWorkbenchSidebar } from './uiWorkbench/UiWorkbenchSidebar'

/** 页脚备注开关图标本体:1.3rem */
const FOOTER_NOTE_ICON_SIZE = 1.3 * ROOT_FONT_BASE_PX

export function WorkspaceSidebar({
  result,
  notes,
  selectedFile,
  selectedFolder,
  expanding,
  revealPaths,
  onOpenFile,
  onSelectDir,
  handleExpandLazy,
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
  driveRefreshNonce,
  onGoHome,
  onOpenBrowseFile,
  sidebarFace,
  settingsSection,
  onSettingsSection,
  sidebarCollapsed,
  outlineOwnerId
}: {
  /** null = 没开工作区:树区换成「这台电脑」盘符列表(§7.1 空态) */
  result: ScanResult | null
  notes: NoteMap
  selectedFile: ScanFileNode | null
  selectedFolder: ScanDirNode | null
  expanding: string | null
  revealPaths: Set<string>
  /** 点文件:选中 + 开文件预览签(App 的 openFile) */
  onOpenFile: (file: ScanFileNode) => Promise<void>
  /** 点文件夹:只选中,不开签(App 的 selectDir) */
  onSelectDir: (node: ScanDirNode) => void
  handleExpandLazy: (relPath: string) => Promise<ScanDirNode | null>
  saveNote: (relPath: string, text: string) => void
  openPreview: (relPath: string) => void
  treeNote: string | null
  /** 顶栏搜索词的深搜状态表(UI v3 §7.2):非 null = 树区整体换成结果清单;
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
  /** 工作区菜单(§7.1):recents 状态表原样进,菜单内部分 pin/历史两区 */
  recents: RecentProject[]
  /** 菜单里点条目:直接进入该工作区(= 输路径回车的同一动作) */
  onOpenWorkspace: (path: string) => void
  /** 行首 pin 钮:pin ↔ unpin,状态表在 App 层写 */
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
  /** 顶栏刷新计数:递增即让盘符浏览树重读已展开的目录 */
  driveRefreshNonce: number
  /** 菜单常驻「我的电脑」:回家,树区交给盘符列 */
  onGoHome: () => void
  /** 浏览态单击文件:开「瞄一眼」预览页签(scopeRoot = 浏览树的盘根) */
  onOpenBrowseFile: (scopeRoot: string, file: { name: string; relPath: string }) => void
  /** 侧栏的脸:激活签是设置页/UI 工作台时换成对应的脸;文件树保活藏着,不丢展开/滚动 */
  sidebarFace: SidebarFace
  /** 设置导航高亮项(App 的 settingsSection 账,滚动间谍喂的) */
  settingsSection: SectionKey
  /** 点导航 = 发一次跳转请求(走 sectionReq 同一条道,seq 记账) */
  onSettingsSection: (key: SectionKey) => void
  /** 侧栏收起(宽收到 0):停靠的大纲得退回浮窗,不然跟着一条看不见的栏一起没了 */
  sidebarCollapsed: boolean
  /** 当前停靠位认的那张签:左栏大纲画它的标题 */
  outlineOwnerId: string | null
}): React.JSX.Element {
  const settingsMode = sidebarFace === 'settings'
  const [notesShown, setNotesShown] = useState(readNotesShown)
  const asideRef = useRef<HTMLElement>(null)
  const dockSlotRef = useRef<HTMLDivElement>(null)
  // 左栏坞位:浮窗拖过来按整条 aside 的框认落点;收起或换脸时让浮窗回来
  useLayoutEffect(() => {
    setSidebarDockHost(asideRef.current)
    setSidebarDockHostUsable(sidebarFace === 'files' && !sidebarCollapsed)
    return () => {
      setSidebarDockHost(null)
      setSidebarDockHostUsable(false)
    }
  }, [sidebarFace, sidebarCollapsed])
  // 停靠槽位:停靠后的面板(大纲/图谱详情)portal 进这块,display:contents 不占版面
  useLayoutEffect(() => {
    setSidebarDockSlot(dockSlotRef.current)
    return () => setSidebarDockSlot(null)
  }, [])
  // 落位框直接拨类名:拖动时整棵文件树不该跟着重渲
  useEffect(() => {
    const el = asideRef.current
    const apply = (): void => {
      el?.classList.toggle('is-dock-target', getSidebarDockState().hot)
    }
    apply()
    return subscribeSidebarDock(apply)
  }, [])
  return (
    <>
      {/* 宽度在 workspace.css 吃 --sidebar-w(顶栏左段同认它):收起动画要靠类名改宽,
          内联样式会压住类规则,所以宽度不挂行内 */}
      <aside className="sidebar" ref={asideRef}>
        {/* 设置模式:顶卡换「设置」标题行,中段换分类导航;
            文件树/搜索结果整棵藏进 .sidebar-mid(display:none 保活不卸载),
            展开态和滚动位都长在节点自己身上,换回来原样还在 */}
        {sidebarFace === 'uiworkbench' ? (
          <UiWorkbenchSidebar />
        ) : settingsMode ? (
          <div className="sidebar-top cfg-snav-head">
            <span className="cfg-snav-title">设置</span>
          </div>
        ) : (
          <WorkspacePathCard
            folder={folder}
            scanning={scanning}
            pathDraft={pathDraft}
            pathHint={pathHint}
            pathShaking={pathShaking}
            pathInputRef={pathInputRef}
            setPathDraft={setPathDraft}
            setPathShaking={setPathShaking}
            dismissPathHint={dismissPathHint}
            goPath={goPath}
            recents={recents}
            onOpenWorkspace={onOpenWorkspace}
            onTogglePin={onTogglePin}
            onRemoveRecent={onRemoveRecent}
            onGoHome={onGoHome}
          />
        )}
        {settingsMode && (
          <nav className="cfg-snav" aria-label="设置导航">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`cfg-snav-item${settingsSection === item.key ? ' is-active' : ''}`}
                onClick={() => onSettingsSection(item.key)}
              >
                <TreeIcon name={item.icon} size={NAV_ICON_SIZE} mono />
                <strong>{item.name}</strong>
              </button>
            ))}
          </nav>
        )}
        <div className="sidebar-mid" hidden={sidebarFace !== 'files'}>
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
                notesShown={notesShown}
                selectedPath={selectedFile?.relPath ?? selectedFolder?.relPath ?? null}
                expandingPath={expanding}
                revealPaths={revealPaths}
                onSelectFile={(_relPath, file) => void onOpenFile(file)}
                onSelectFolder={onSelectDir}
                onExpandLazy={(relPath) => void handleExpandLazy(relPath)}
                onNoteSave={saveNote}
                onNoteRemove={(relPath) => saveNote(relPath, '')}
                onPreviewFile={openPreview}
                onOpenWorkspace={onOpenWorkspace}
              />
            )
          ) : (
            /* 「这台电脑」空态(§7.1):盘符列表可下钻 —— 单击原地展开,
             双击开为工作区,单击文件开预览页签 */
            <DriveBrowser
              drives={drives}
              drivesNote={drivesNote}
              refreshNonce={driveRefreshNonce}
              onOpenWorkspace={onOpenWorkspace}
              onOpenFile={onOpenBrowseFile}
            />
          )}
          <div className="sidebar-dock-slot" ref={dockSlotRef} />
          <SidebarOutline ownerId={outlineOwnerId} />
        </div>
        {/* 页脚站在分割区外面:文件树与大纲按比例分的是它上面的整块高度 */}
        {result && sidebarFace === 'files' && (
          <footer className="sidebar-footer">
            <span
              className="sidebar-counts"
              role="img"
              aria-label={`${result.stats.dirCount} 个文件夹,${result.stats.fileCount} 个文件`}
              data-tip="文件夹 / 文件"
              data-tip-side="top"
            >
              {result.stats.dirCount} / {result.stats.fileCount}
            </span>
            <button
              type="button"
              className="sidebar-notes-toggle"
              aria-pressed={notesShown}
              aria-label={notesShown ? '隐藏文件备注' : '显示文件备注'}
              data-tip={notesShown ? '隐藏备注' : '显示备注'}
              data-tip-side="top"
              onClick={() => {
                const next = !notesShown
                setNotesShown(next)
                writeNotesShown(next)
              }}
            >
              <NoteToggleIcon off={!notesShown} size={FOOTER_NOTE_ICON_SIZE} />
            </button>
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
