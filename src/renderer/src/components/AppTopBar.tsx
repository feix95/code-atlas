// v3 顶栏(第 1 层 · 整行盖头):收起钮 | 搜索框 | 导航组 | 页签区 | 窗控三键。
// 左段盖住 rail + 侧栏的正上方,右缘细线就是「侧栏 | 内容」分界线的上行段;
// 侧栏收起/无项目时左段收成 1u,只剩收起钮。页签区(B3)进来前,整条都是拖拽面。
import type { NavLocation } from '../navHistory'
import { IconArrowLeft, IconArrowRight, IconRefresh, TreeIcon } from './Icons'
import { useWindowMaximized } from '../useWindowMaximized'

/** 顶栏图标本体 0.5u ≈ 32px@100%;24 栅格放到 32px,描边降一档才不闷(有效粗 ≈2px) */
const TOP_ICON = 32
const TOP_ICON_STROKE = 1.5

export function AppTopBar({
  scanning,
  hasWorkspace,
  sidebarShown,
  sidebarCollapsed,
  onToggleSidebar,
  nav,
  goNav,
  handleRefresh,
  filter,
  onFilterChange,
  tabs
}: {
  scanning: boolean
  /** 工作区在台面上;没开项目时搜索框置灰(深搜要有工作区根,规格默认项) */
  hasWorkspace: boolean
  /** 侧栏这一列此刻露着 = 搜索框/导航组才营业(收起时整组消失,规格 §4.3) */
  sidebarShown: boolean
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  nav: { stack: NavLocation[]; index: number }
  goNav: (delta: number) => Promise<void>
  handleRefresh: () => Promise<void>
  filter: string
  onFilterChange: (v: string) => void
  /** Chrome 页签带(B3):App 按页签组算好条带宽度递进来;
      空/没项目时不递,页签区就是一条可拖窗的空白面 */
  tabs?: React.ReactNode
}): React.JSX.Element {
  const maximized = useWindowMaximized()
  return (
    <header className="topbar">
      <div className={`topbar-side${sidebarShown ? '' : ' is-bare'}`}>
        {/* 收起侧栏:顶栏最左端,独占 1u 列,图标骑 rail 中线(x=0.5u) */}
        <div className="tb-collapse">
          <button
            type="button"
            className="tb-btn"
            onClick={onToggleSidebar}
            /* 侧栏常驻(v3:首页就是「这台电脑」),有没有项目都能收起;只在扫描期禁动 */
            disabled={scanning}
            title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            aria-pressed={sidebarCollapsed}
          >
            <TreeIcon name="panelLeft" size={TOP_ICON} strokeWidth={TOP_ICON_STROKE} mono />
          </button>
        </div>
        {sidebarShown && (
          <>
            {/* 工作区文件名搜索:B1 先接旧的树内过滤,深搜升级在 B7 */}
            <label className="tb-search">
              <TreeIcon name="search" size={18} mono />
              <input
                type="search"
                value={filter}
                placeholder={hasWorkspace ? '搜索文件' : '先打开一个文件夹'}
                aria-label="搜索文件"
                spellCheck={false}
                disabled={!hasWorkspace}
                onChange={(e) => onFilterChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onFilterChange('')
                }}
              />
            </label>
            {/* 导航组 ← → ↻:贴左段右缘(分隔线左侧),可用态沿用旧逻辑 */}
            <div className="tb-nav">
              <button
                type="button"
                className="tb-btn"
                onClick={() => void goNav(-1)}
                disabled={scanning || nav.index <= 0}
                title="后退"
                aria-label="后退"
              >
                <IconArrowLeft size={TOP_ICON} strokeWidth={TOP_ICON_STROKE} mono />
              </button>
              <button
                type="button"
                className="tb-btn"
                onClick={() => void goNav(1)}
                disabled={scanning || nav.index >= nav.stack.length - 1}
                title="前进"
                aria-label="前进"
              >
                <IconArrowRight size={TOP_ICON} strokeWidth={TOP_ICON_STROKE} mono />
              </button>
              <button
                type="button"
                className="tb-btn"
                onClick={() => void handleRefresh()}
                disabled={scanning}
                title={scanning ? '扫描中……' : '刷新'}
                aria-label="刷新"
              >
                <IconRefresh size={TOP_ICON} strokeWidth={TOP_ICON_STROKE} mono />
              </button>
            </div>
          </>
        )}
      </div>
      {/* 页签区(§5.1):各分屏组的胶囊页签带;缝隙与尾部空白仍是拖窗面 */}
      <div className="topbar-tabs">{tabs}</div>
      {/* 窗控三键:整高块并排;— ▢ 悬停灰底,× 悬停红底白叉(Windows 惯例) */}
      <div className="win-ctl">
        <button
          type="button"
          className="win-btn win-min"
          onClick={() => void window.atlas.windowMinimize()}
          title="最小化"
          aria-label="最小化"
        >
          <i aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`win-btn win-max${maximized ? ' is-restore' : ''}`}
          onClick={() => void window.atlas.windowMaximizeToggle()}
          title={maximized ? '还原' : '最大化'}
          aria-label={maximized ? '还原' : '最大化'}
        >
          <i aria-hidden="true" />
        </button>
        <button
          type="button"
          className="win-btn win-close"
          onClick={() => void window.atlas.windowClose()}
          title="关闭"
          aria-label="关闭"
        >
          <i aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
