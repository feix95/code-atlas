// 撕窗子窗的壳(页签撕窗锤):同一棵 React 树渲染进子窗 document 的整套外壳 ——
// 自绘标题栏(拖窗区 + 窗控三键,操作经主 realm 代发 IPC 按 frameName 认窗)、
// 完整页签带 + 分屏正文(主窗同款组件,户口过滤后递进来)、本窗自己的 TooltipHost。
// 空壳即死:名下签全挪走/关光那刻,这扇窗自己收摊(Chrome 语义;主窗不在此列,它是工作台)。
import { useEffect } from 'react'
import type { PaneGroup, PaneTab } from '../paneTabs'
import { syncAuxChrome, type AuxWindowHandle } from '../useAuxWindows'
import { TopBarTabs } from './TopBarTabs'
import { PaneGroups } from './PaneGroups'
import { TooltipHost } from './Tooltip'
import { FilePathMenu } from './FilePathMenu'
import { ContextMenu } from './ContextMenu'

/** 页签区那套接线的主窗/子窗通用包:两边吃的 props 一模一样,打包传不重抄 */
export interface TabAreaProps {
  visibleOfGroup: (g: PaneGroup | null) => PaneTab[]
  flashTabId: string | null
  activateTab: (id: string) => void
  closeTab: (id: string) => void
  moveTab: (
    id: string,
    toGroup: 'sibling' | null,
    atIndex: number | null,
    splitSide?: 'left' | 'right'
  ) => void
  setDropMark: React.Dispatch<
    React.SetStateAction<{ groupId: string; zone: 'center' | 'left' | 'right' } | null>
  >
  onTabDragEnd: (id: string) => void
  onDetachTab: (id: string) => void
  paneSplit: number
  setActiveGroupId: React.Dispatch<React.SetStateAction<string | null>>
  dropMark: { groupId: string; zone: 'center' | 'left' | 'right' } | null
  onPaneSashDown: (e: React.PointerEvent<HTMLDivElement>) => void
  applyPaneSplit: (v: number) => void
  renderTabBody: (tab: PaneTab) => React.ReactNode
}

export function AuxWindowShell({
  aux,
  groups,
  tabArea,
  onRequestClose
}: {
  aux: AuxWindowHandle
  /** 这扇窗名下的组(App 已按 host 过滤好) */
  groups: PaneGroup[]
  tabArea: TabAreaProps
  /** 名下签全没了自己收摊:让 App 调 closeAuxWindow 关窗 */
  onRequestClose: () => void
}): React.JSX.Element {
  const doc = aux.win.document
  const totalTabs = groups.reduce((n, g) => n + g.tabs.length, 0)

  // 外观对账:主题/根字号/窗态类名跟着主窗走,每帧渲染顺手抄一遍
  useEffect(() => {
    syncAuxChrome(doc)
  })

  // 空壳即死:这扇窗名下一张签都不剩了(挪光/关光),自裁交还桌面。
  // 挂载即空的情形不存在 —— 开窗和挪签同一笔账,壳立起来时名下必有签
  useEffect(() => {
    if (totalTabs === 0) onRequestClose()
  }, [totalTabs, onRequestClose])

  return (
    <div className="aux-shell">
      {/* 页签带兼标题栏(浏览器同款):带尾空白 = 拖窗面,窗控三键钉带尾。
          双击空白 = 最大化/还原;点到页签/按钮上的双击不算 */}
      <div
        className="aux-strip"
        onDoubleClick={(e) => {
          // .tabbar-blank 自己有双击最大化的户口(hostNameOf 报窗),别重复 toggle
          if ((e.target as HTMLElement).closest('.tabbar-tab, .aux-winbtn, .tabbar-blank')) return
          window.atlas.auxWindowOp(aux.id, 'toggleMaximize')
        }}
      >
        <TopBarTabs
          groups={groups}
          visibleOfGroup={tabArea.visibleOfGroup}
          flashTabId={tabArea.flashTabId}
          activateTab={tabArea.activateTab}
          closeTab={tabArea.closeTab}
          moveTab={tabArea.moveTab}
          setDropMark={tabArea.setDropMark}
          onTabDragEnd={tabArea.onTabDragEnd}
          onDetachTab={tabArea.onDetachTab}
          paneSplit={tabArea.paneSplit}
        />
        <div className="aux-winbtns">
          <button
            type="button"
            className="aux-winbtn"
            aria-label="最小化"
            data-tip="最小化"
            onClick={() => window.atlas.auxWindowOp(aux.id, 'minimize')}
          >
            –
          </button>
          <button
            type="button"
            className="aux-winbtn"
            aria-label="最大化/还原"
            data-tip="最大化/还原"
            onClick={() => window.atlas.auxWindowOp(aux.id, 'toggleMaximize')}
          >
            □
          </button>
          <button
            type="button"
            className="aux-winbtn is-close"
            aria-label="关闭窗口"
            data-tip="关闭窗口(连签一起关)"
            onClick={() => window.atlas.auxWindowOp(aux.id, 'close')}
          >
            ×
          </button>
        </div>
      </div>
      <div className="aux-panes">
        <PaneGroups
          groups={groups}
          setActiveGroupId={tabArea.setActiveGroupId}
          dropMark={tabArea.dropMark}
          onPaneSashDown={tabArea.onPaneSashDown}
          applyPaneSplit={tabArea.applyPaneSplit}
          paneSplit={tabArea.paneSplit}
          renderTabBody={tabArea.renderTabBody}
        />
      </div>
      {/* 这扇窗自己的提示台 + 两台右键菜单:听的是子窗 document 的动静,主窗那台够不着 */}
      <TooltipHost doc={doc} />
      <FilePathMenu />
      <ContextMenu />
    </div>
  )
}
