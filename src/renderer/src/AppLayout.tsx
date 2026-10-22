// 应用外壳:顶栏 + rail + 侧栏 + 正文 + 全局浮层 + 独立子窗。只摆画,不碰业务。
import type { ComponentProps, ReactNode } from 'react'
import { ROOT_FONT_BASE_PX } from '@shared/uiScale'
import { AiSetupContext } from './aiSetupContext'
import { AppTopBar } from './components/AppTopBar'
import { AuxWindows } from './components/AuxWindows'
import type { TabAreaProps } from './components/AuxWindowShell'
import { ContextMenu } from './components/ContextMenu'
import { FilePathMenu } from './components/FilePathMenu'
import { PaneGroups } from './components/PaneGroups'
import { Rail } from './components/Rail'
import { ScanOrError } from './components/ScanOrError'
import { TabBody } from './components/TabBody'
import { Toast } from './components/Toast'
import { TooltipHost } from './components/Tooltip'
import { TopBarTabs } from './components/TopBarTabs'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import { groupsForHost, MAIN_HOST, type PaneGroup } from './paneTabs'
import type { ToastState } from './useToast'

/** 页签区的通用接线:主窗顶栏、每组正文、独立子窗吃的是同一副药 */
export interface TabControlProps {
  groups: PaneGroup[]
  visibleOfGroup: TabAreaProps['visibleOfGroup']
  flashTabId: TabAreaProps['flashTabId']
  activateTab: TabAreaProps['activateTab']
  closeTab: TabAreaProps['closeTab']
  closeTabsInGroup: TabAreaProps['closeTabsInGroup']
  moveTab: TabAreaProps['moveTab']
  onMoveTabToHostAt: TabAreaProps['onMoveTabToHostAt']
  setDropMark: TabAreaProps['setDropMark']
  onTabDragEnd: TabAreaProps['onTabDragEnd']
  onDetachTab: TabAreaProps['onDetachTab']
  revealTabInTree: TabAreaProps['revealTabInTree']
  translateTab: ComponentProps<typeof TopBarTabs>['onTranslate']
  workspaceRoot: string | null
  paneSplit: TabAreaProps['paneSplit']
  setActiveGroupId: ComponentProps<typeof PaneGroups>['setActiveGroupId']
  dropMark: TabAreaProps['dropMark']
  onPaneSashDown: TabAreaProps['onPaneSashDown']
  applyPaneSplit: TabAreaProps['applyPaneSplit']
}

export function AppLayout(props: {
  revived: boolean
  sidebarCollapsed: boolean
  sidebarWidth: number
  uiScale: number
  aiConfigured: boolean | null
  openAiSettings: () => void
  isOnAiSettings: boolean
  toast: ToastState | null
  topBar: Omit<ComponentProps<typeof AppTopBar>, 'tabs'>
  rail: ComponentProps<typeof Rail>
  sidebar: ComponentProps<typeof WorkspaceSidebar>
  tabs: TabControlProps
  /** 正文各页签的共同料;每组各自补 tab */
  tabBody: Omit<ComponentProps<typeof TabBody>, 'tab'>
  workspace: {
    hasWorkspace: boolean
    scanning: boolean
    error: string | null
    onRetry: () => void
    onPick: () => void
    onGoHome: () => void
  }
  auxWins: ComponentProps<typeof AuxWindows>['auxWins']
  closeAuxWindow: ComponentProps<typeof AuxWindows>['onRequestClose']
}) {
  const {
    revived,
    sidebarCollapsed,
    sidebarWidth,
    uiScale,
    aiConfigured,
    openAiSettings,
    isOnAiSettings,
    toast,
    topBar,
    rail,
    sidebar,
    tabs,
    tabBody,
    workspace,
    auxWins,
    closeAuxWindow
  } = props

  // 主窗名下的组:顶栏页签带和正文只画这些,子窗的签在子窗自己带里
  const mainGroups = groupsForHost(tabs.groups, MAIN_HOST)
  // 跨窗拖页签的窗口清单:主窗在前,子窗按打开顺序;矩形由主进程按窗口现取。
  // 主窗零组时也要在清单里 —— 拖回主窗靠正文兜底落点现立一组
  const dragWindows = [
    { host: MAIN_HOST, win: window },
    ...auxWins.map((a) => ({ host: a.id, win: a.win }))
  ]
  const renderTabBody: TabAreaProps['renderTabBody'] = (t) => <TabBody {...tabBody} tab={t} />
  const tabArea: TabAreaProps = {
    visibleOfGroup: tabs.visibleOfGroup,
    flashTabId: tabs.flashTabId,
    activateTab: tabs.activateTab,
    closeTab: tabs.closeTab,
    closeTabsInGroup: tabs.closeTabsInGroup,
    moveTab: tabs.moveTab,
    onMoveTabToHostAt: tabs.onMoveTabToHostAt,
    setDropMark: tabs.setDropMark,
    onTabDragEnd: tabs.onTabDragEnd,
    onDetachTab: tabs.onDetachTab,
    dragWindows,
    revealTabInTree: tabs.revealTabInTree,
    workspaceRoot: tabs.workspaceRoot,
    paneSplit: tabs.paneSplit,
    setActiveGroupId: tabs.setActiveGroupId,
    dropMark: tabs.dropMark,
    onPaneSashDown: tabs.onPaneSashDown,
    applyPaneSplit: tabs.applyPaneSplit,
    renderTabBody
  }
  // 顶栏页签带照常对齐,正文就是那张签(只画主窗名下的组);
  // 首页开的单例签(设置)也要能点能 ×,所以不看工作区
  const paneGroupsEl: ReactNode = (
    <PaneGroups
      groups={mainGroups}
      setActiveGroupId={tabs.setActiveGroupId}
      dropMark={tabs.dropMark}
      onPaneSashDown={tabs.onPaneSashDown}
      applyPaneSplit={tabs.applyPaneSplit}
      paneSplit={tabs.paneSplit}
      renderTabBody={renderTabBody}
    />
  )

  return (
    <AiSetupContext.Provider
      value={{ configured: aiConfigured, openSettings: openAiSettings, isOnAiSettings }}
    >
      <div
        className={`app${sidebarCollapsed ? ' is-side-collapsed' : ''}`}
        // 侧栏宽挂 CSS 变量:侧栏本体和顶栏左段(分界线的上行段)同认这一份,
        // 拖 sash 时两边永远对齐;rem 值 = 基准宽 ÷ (16 × uiScale)
        style={
          {
            '--sidebar-w': `${(sidebarWidth / (ROOT_FONT_BASE_PX * uiScale)).toFixed(4)}rem`
          } as React.CSSProperties
        }
      >
        {revived && (
          <div className="revive-note" role="alert">
            画面刚才断了一次,已经自动接上 —— 正在跑的扫描和后台引擎都没受影响,页面回到了刚打开的样子
          </div>
        )}
        <AppTopBar
          {...topBar}
          tabs={
            mainGroups.length > 0 ? (
              <TopBarTabs
                groups={mainGroups}
                host={MAIN_HOST}
                dragWindows={dragWindows}
                onMoveTabToHostAt={tabs.onMoveTabToHostAt}
                visibleOfGroup={tabs.visibleOfGroup}
                flashTabId={tabs.flashTabId}
                activateTab={tabs.activateTab}
                closeTab={tabs.closeTab}
                closeTabsInGroup={tabs.closeTabsInGroup}
                moveTab={tabs.moveTab}
                setDropMark={tabs.setDropMark}
                onTabDragEnd={tabs.onTabDragEnd}
                onDetachTab={tabs.onDetachTab}
                onRevealInTree={tabs.revealTabInTree}
                onTranslate={tabs.translateTab}
                workspaceRoot={tabs.workspaceRoot}
                paneSplit={tabs.paneSplit}
              />
            ) : null
          }
        />

        {/* 第 2 层:rail | 侧栏 | 内容区,全在顶栏之下。
              侧栏常驻(不存在空侧栏):没开工作区时树区 = 「这台电脑」盘符列表 */}
        <div className="app-body">
          <Rail {...rail} />
          {/* 侧栏常驻挂载:收起改成宽动画收到 0(visibility 延迟隐),
                不是卸载 —— 展开态的滚动/勾选都留得住 */}
          <WorkspaceSidebar {...sidebar} />
          {workspace.hasWorkspace && !workspace.scanning ? (
            <main className="workspace">
              <section className="detail">{paneGroupsEl}</section>
            </main>
          ) : workspace.scanning || workspace.error ? (
            // 扫描中/失败:这两种状态优先于页签区;其余情况(含没开项目)一律进签区,
            // 空签组自然落空板
            <ScanOrError
              scanning={workspace.scanning}
              error={workspace.error}
              onRetry={workspace.onRetry}
              onPick={workspace.onPick}
              onGoHome={workspace.onGoHome}
            />
          ) : (
            // 没开工作区也能有房:单例签(设置/图谱)孤零零一张签也要正文区
            <main className="workspace">
              <section className="detail">{paneGroupsEl}</section>
            </main>
          )}
        </div>

        {/* 悬停轻提示(全场唯一登记):认 data-tip 属性,fixed 挂 body 不吃侧栏 overflow */}
        <TooltipHost />
        <Toast toast={toast} />
        {/* 文件路径右键菜单(全局单例):绿字文件链接上右键弹「复制完整路径」,只复制不打开 */}
        <FilePathMenu />
        {/* 通用右键菜单(全局单例,第二台):选区「引用到对话」这类不对着文件的右键走这儿 */}
        <ContextMenu />
      </div>

      {/* 独立子窗:壳本体在 AuxWindows 组件,Portal 渲染进子窗 document ——
            同一棵 React 树,活的签的页签活 DOM 整体迁移 */}
      <AuxWindows
        auxWins={auxWins}
        groups={tabs.groups}
        tabArea={tabArea}
        onRequestClose={closeAuxWindow}
      />
    </AiSetupContext.Provider>
  )
}
