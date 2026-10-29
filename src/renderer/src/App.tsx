// 组合根:把各域钩子接到一起,再交给 AppLayout 摆画。业务细节都在钩子和组件里。
import { useEffect, useRef, useState } from 'react'
import type { ScanResult } from '@shared/types'
import { AppLayout, type TabControlProps } from './AppLayout'
import type { NavLocation } from './navHistory'
import { createRequestScope } from './requestScope'
import { useAiChat } from './useAiChat'
import { useAiConfigured } from './useAiConfigured'
import { useAuxWindows } from './useAuxWindows'
import { useChatContext } from './useChatContext'
import { useFileActions } from './useFileActions'
import { useFileRename } from './useFileRename'
import { useLazyExpand } from './useLazyExpand'
import { useMaximizedBodyClass } from './useMaximizedBodyClass'
import { useNavStack } from './useNavStack'
import { usePaneTabs } from './usePaneTabs'
import { usePreviewRefs } from './usePreviewRefs'
import { useRendererRevival } from './useRendererRevival'
import { useSessionRestore } from './useSessionRestore'
import { useSettingsNav } from './useSettingsNav'
import { useSidebarSash } from './useSidebarSash'
import { useToast } from './useToast'
import { useWorkspaceScan } from './useWorkspaceScan'
import { useWorkspaceSearch } from './useWorkspaceSearch'
import { useZoomKeys } from './useZoomKeys'

function App(): React.JSX.Element {
  const revived = useRendererRevival()
  const { toast, showToast } = useToast()
  // 扫描票据:开图/探目录/算图谱共用一套代际账,换项目一律作废上一代
  const requests = useRef(createRequestScope())
  // 当前工作区:扫描结果与路径放这儿 —— 搜索、页签、正文、会话复现都要吃
  const [result, setResult] = useState<ScanResult | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  // reveal 联动:激活页签/跳转目标在树里的父目录链,这些目录强制展开 + 滚到可见
  const [revealPaths, setRevealPaths] = useState<Set<string>>(new Set())
  const { aiConfigured, applyAiConfig } = useAiConfigured()

  // 顶栏搜索词 ↔ 深搜账:防抖/seq/按词对齐全在钩子里,App 只拿词和清单面板
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    panel: searchPanel,
    clear: clearSearch
  } = useWorkspaceSearch(result?.rootPath ?? null)

  const { expanding, treeNote, expandLazy, resetExpansion } = useLazyExpand({
    result,
    setResult,
    requests
  })

  // 窗口壳:侧栏宽度与分界拖拽
  const {
    uiScale,
    sidebarWidth,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    onSashPointerDown,
    onSashPointerMove,
    endSashDrag,
    onSashDoubleClick,
    onSashKeyDown
  } = useSidebarSash()
  // Ctrl+滚轮/键盘 ±0 缩放界面(浏览器惯例):走 setUiScale 原路
  useZoomKeys(() => {})
  // 独立子窗口标识:window.open 同进程子窗 + Portal 渲染坑位
  const { auxWins, openAuxWindow, closeAuxWindow, onAuxGone } = useAuxWindows()

  const pane = usePaneTabs({
    result,
    openAuxWindow: () => openAuxWindow()?.id ?? null,
    setRevealPaths
  })

  const files = useFileActions({
    result,
    folder,
    // 导航栈在下面才立得起来:记一站要等选中动作齐活(运行时才调)
    pushNav: (loc: NavLocation) => pushNav(loc),
    openFileTab: pane.openFileTab,
    showToast,
    setRevealPaths,
    expandLazy,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    groups: pane.groups
  })

  const workspace = useWorkspaceScan({
    requests,
    folder,
    setFolder,
    result,
    setResult,
    clearSelection: files.clearSelection,
    resetExpansion,
    resetPaneTabs: pane.resetPaneTabs,
    setPreviewRefs: (next) => setPreviewRefs(next),
    clearSearch,
    pushNav: (loc: NavLocation) => pushNav(loc),
    setGroups: pane.setGroups,
    setActiveGroupId: pane.setActiveGroupId,
    dismissTabFlash: pane.dismissTabFlash,
    setRevealPaths,
    showToast
  })

  // 公用场的聊天上下文:跟着选中的文件/文件夹走;什么都没选就聊项目根
  const chatContext = useChatContext({
    result,
    selectedFile: files.selectedFile,
    selectedFolder: files.selectedFolder,
    structure: files.structure
  })
  // 翻文件模式(agent)的项目根从这儿递进去:沙盒只认这个目录,越界的活儿一律不接
  const chat = useAiChat(chatContext, result?.rootPath ?? null)
  // chatRef 两处用:气泡代发输入的订阅回调(永远调最新场次)、openFileLink 的稳定身份(MiniMD memo)
  const chatRef = useRef(chat)
  useEffect(() => {
    chatRef.current = chat
  })

  // 窗口壳:最大化时圆角描边要收掉;状态挂 body 上,抽屉跟着一起换装
  useMaximizedBodyClass()

  // 设置导航中枢:模式判定、侧栏收起态进出账、分类跳转请求都收在钩里
  const settings = useSettingsNav({
    activeGroup: pane.activeGroup,
    openSingletonTab: pane.openSingletonTab,
    sidebarCollapsed,
    toggleSidebarCollapsed
  })
  const { nav, pushNav, goNav } = useNavStack({
    folder,
    result,
    scanning: workspace.scanning,
    scanPath: workspace.scanPath,
    goHome: workspace.goHome,
    openFile: files.openFile,
    selectDir: files.selectDir,
    clearSelection: files.clearSelection
  })
  const {
    previewRefs,
    setPreviewRefs,
    previewJump,
    fileLinks,
    addPreviewRef,
    removePreviewRef,
    handleDropRef
  } = usePreviewRefs({
    result,
    notes: workspace.notes,
    chat,
    chatRef,
    openPreview: files.openPreview,
    groups: pane.groups,
    activeGroup: pane.activeGroup,
    markFlash: pane.markFlash,
    saveNote: workspace.saveNote
  })

  // 内联标题改名:编排本体在 useFileRename,这里只递状态表 ——
  // 树/选中/备注/引用/页签登记一次换清新路径
  const handleRenameFile = useFileRename({
    result,
    selectedFile: files.selectedFile,
    folder,
    notes: workspace.notes,
    setResult,
    setSelectedFile: files.setSelectedFile,
    setNotes: workspace.setNotes,
    setPreviewRefs,
    renameFileTab: pane.renameFileTab
  })

  // 会话复现(Obsidian 式):开机还原上次的工作区+页签布局,账目变动防抖落账
  useSessionRestore({
    folder,
    groups: pane.groups,
    activeGroupId: pane.activeGroupId,
    selectedFile: files.selectedFile,
    selectedFolder: files.selectedFolder,
    setGroups: pane.setGroups,
    setActiveGroupId: pane.setActiveGroupId,
    setSelectedFile: files.setSelectedFile,
    setSelectedFolder: files.setSelectedFolder,
    setRevealPaths,
    scanPath: workspace.scanPath
  })

  // 子窗死讯 → 它名下的签连带关闭并清理该组(Chrome 语义:关窗即关签)
  useEffect(() => {
    onAuxGone(pane.closeHostGroups)
  }, [onAuxGone, pane.closeHostGroups])

  // 页签区通用接线:主窗和每扇子窗吃的是同一副药
  const tabs: TabControlProps = {
    groups: pane.groups,
    activeGroupId: pane.activeGroupId,
    visibleOfGroup: pane.visibleOfGroup,
    flashTabId: pane.flashTabId,
    activateTab: pane.activateTab,
    closeTab: pane.closeTab,
    closeTabsInGroup: pane.closeTabsInGroup,
    moveTab: pane.moveTab,
    onMoveTabToHostAt: pane.moveTabToHostAt,
    setDropMark: pane.setDropMark,
    onTabDragEnd: pane.onTabDragEnd,
    onDetachTab: pane.onDetachTab,
    revealTabInTree: files.revealTabInTree,
    translateTab: pane.translateTab,
    workspaceRoot: result?.rootPath ?? null,
    paneSplit: pane.paneSplit,
    setActiveGroupId: pane.setActiveGroupId,
    dropMark: pane.dropMark,
    onPaneSashDown: pane.onPaneSashDown,
    applyPaneSplit: pane.applyPaneSplit
  }

  return (
    <AppLayout
      revived={revived}
      sidebarCollapsed={sidebarCollapsed}
      sidebarWidth={sidebarWidth}
      uiScale={uiScale}
      aiConfigured={aiConfigured}
      openAiSettings={settings.openAiSettings}
      isOnAiSettings={settings.settingsMode && settings.settingsSection === 'ai'}
      toast={toast}
      topBar={{
        scanning: workspace.scanning,
        hasWorkspace: result !== null,
        fileNavOff: settings.sidebarFace !== 'files',
        sidebarShown: !sidebarCollapsed,
        sidebarCollapsed,
        onToggleSidebar: toggleSidebarCollapsed,
        nav,
        goNav,
        handleRefresh: workspace.handleRefresh,
        refreshing: workspace.refreshing,
        filter: searchQuery,
        onFilterChange: setSearchQuery
      }}
      rail={{
        hasWorkspace: result !== null && !workspace.scanning,
        onGraph: () => pane.openSingletonTab('graph'),
        onChat: () => pane.openSingletonTab('chat'),
        onUiWorkbench: () => pane.openSingletonTab('uiworkbench'),
        onSettings: () => settings.openSettings()
      }}
      sidebar={{
        result,
        notes: workspace.notes,
        selectedFile: files.selectedFile,
        selectedFolder: files.selectedFolder,
        expanding,
        revealPaths,
        onOpenFile: files.openFile,
        onSelectDir: files.selectDir,
        handleExpandLazy: expandLazy,
        saveNote: workspace.saveNote,
        openPreview: files.openPreview,
        treeNote,
        search: searchPanel,
        onOpenSearchFile: (hit) => void files.openSearchFile(hit),
        onOpenSearchDir: (hit) => void workspace.scanPath(hit.absPath),
        folder,
        scanning: workspace.scanning,
        pathDraft: workspace.pathDraft,
        pathHint: workspace.pathHint,
        pathShaking: workspace.pathShaking,
        pathInputRef: workspace.pathInputRef,
        setPathDraft: workspace.setPathDraft,
        dismissPathHint: workspace.dismissPathHint,
        goPath: workspace.goPath,
        setPathShaking: workspace.setPathShaking,
        recents: workspace.recents,
        onOpenWorkspace: (path) => void workspace.scanPath(path),
        onTogglePin: workspace.togglePinRecent,
        onRemoveRecent: workspace.removeRecent,
        sidebarWidth,
        onSashPointerDown,
        onSashPointerMove,
        endSashDrag,
        onSashDoubleClick,
        onSashKeyDown,
        drives: workspace.drives,
        drivesNote: workspace.drivesNote,
        driveRefreshNonce: workspace.driveRefreshNonce,
        onGoHome: workspace.goHome,
        sidebarFace: settings.sidebarFace,
        settingsSection: settings.settingsSection,
        onSettingsSection: settings.openSettings,
        onOpenBrowseFile: files.openBrowseFile
      }}
      tabs={tabs}
      tabBody={{
        result,
        previewRefs,
        previewJump,
        graph: workspace.graph,
        graphLoading: workspace.graphLoading,
        graphNote: workspace.graphNote,
        chat,
        fileLinks,
        handleLoadGraph: workspace.loadGraph,
        expandLazy,
        openPreview: files.openPreview,
        addPreviewRef,
        removePreviewRef,
        handleDropRef,
        onRenameFile: handleRenameFile,
        settingsWorkspaceName: folder ? (folder.split(/[\\/]/).pop() ?? null) : null,
        settingsSectionReq: settings.settingsReq,
        onSettingsSection: settings.setSettingsSection,
        onAiConfigSaved: applyAiConfig
      }}
      workspace={{
        hasWorkspace: result !== null,
        scanning: workspace.scanning,
        error: workspace.error,
        onRetry: () => (folder ? void workspace.scanPath(folder) : void workspace.handlePick()),
        onPick: () => void workspace.handlePick(),
        onGoHome: workspace.goHome
      }}
      auxWins={auxWins}
      closeAuxWindow={closeAuxWindow}
    />
  )
}

export default App
