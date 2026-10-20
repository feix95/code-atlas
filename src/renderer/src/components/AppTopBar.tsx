// v3 顶栏(第 1 层 · 整行盖头):收起钮 | 搜索框 | 导航组 | 页签区 | 窗控三键。
// 左段盖住 rail + 侧栏的正上方,右缘细线就是「侧栏 | 内容」分界线的上行段;
// 侧栏收起/无项目时左段收成 1u,只剩收起钮。页签区(B3)进来前,整条都是拖拽面。
import { useEffect, useRef, useState } from 'react'
import type { NavLocation } from '../navHistory'
import { IconArrowLeft, IconArrowRight, IconRefresh, TreeIcon } from './Icons'
import { useWindowMaximized } from '../useWindowMaximized'
import { isDeadSpace, startWindowDrag } from '../windowDrag'
import { WIN_ICON_SIZE } from '../inputMetrics'
import { CH } from '@shared/ipcChannels'

/** 顶栏图标本体 0.5u ≈ 32px@100%;24 栅格放到 32px,描边降一档才不闷(有效粗 ≈2px) */
const TOP_ICON = 25
const TOP_ICON_STROKE = 2
const REFRESH_ICON = 22

/** 禁用提示的框宽降级链:塞得下的最长一档胜出,全塞不下落最末档 */
const FIT_HINTS = ['先打开一个文件夹', '先打开文件夹', '打开文件夹', '搜索文件'] as const
/** 文案与 input 边缘的余量:贴边刚好看不见切不算「放得下」 */
const FIT_MARGIN_PX = 8
/** is-tight 收紧 padding/gap 腾出的宽度(0.75rem→0.375rem + gap 8px→4px) */
const TIGHT_SAVED_PX = 16

/** 框宽降级 placeholder:ResizeObserver 盯 input 实宽,canvas 按当前字号实测各档
    文案宽,挑塞得下的最长一档;整句塞不下时进 tight 档收 padding/gap 再腾宽。
    进出 tight 用「正常态可用宽」这一根线判,迟滞天然在(腾宽 16px 即两阈值差),
    边界宽度不会来回抖;拖侧栏/改缩放都会重估。 */
function useFittedPlaceholder(
  inputRef: React.RefObject<HTMLInputElement | null>,
  enabled: boolean
): { text: string; tight: boolean } {
  const [fit, setFit] = useState({ text: FIT_HINTS[0] as string, tight: false })
  useEffect(() => {
    const input = inputRef.current
    if (!enabled || !input) {
      setFit({ text: FIT_HINTS[0], tight: false })
      return
    }
    const ctx = document.createElement('canvas').getContext('2d')
    let tight = false
    const pick = () => {
      const w = input.clientWidth
      if (w < FIT_MARGIN_PX || !ctx) return
      const cs = getComputedStyle(input)
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      // 判 tight 永远按「正常 padding 下的可用宽」算:已 tight 就先扣回腾出的部分
      const normalAvail = w - (tight ? TIGHT_SAVED_PX : 0)
      const nextTight = ctx.measureText(FIT_HINTS[0]).width + FIT_MARGIN_PX > normalAvail
      // 本次转 tight 则 input 会变宽,预支它再挑档;转回正常同理已在 normalAvail 里判过
      const avail = w + (nextTight && !tight ? TIGHT_SAVED_PX : 0)
      tight = nextTight
      const text =
        FIT_HINTS.find((t) => ctx.measureText(t).width + FIT_MARGIN_PX <= avail) ??
        FIT_HINTS[FIT_HINTS.length - 1]
      setFit((prev) => (prev.text === text && prev.tight === tight ? prev : { text, tight }))
    }
    const ro = new ResizeObserver(pick)
    ro.observe(input)
    window.addEventListener(CH.uiScaleChanged, pick)
    pick()
    return () => {
      ro.disconnect()
      window.removeEventListener(CH.uiScaleChanged, pick)
    }
  }, [inputRef, enabled])
  return fit
}

export function AppTopBar({
  scanning,
  hasWorkspace,
  fileNavOff,
  sidebarShown,
  sidebarCollapsed,
  onToggleSidebar,
  nav,
  goNav,
  handleRefresh,
  refreshing,
  filter,
  onFilterChange,
  tabs
}: {
  scanning: boolean
  /** 工作区在台面上;没开项目时搜索框置灰(深搜要有工作区根,规格默认项) */
  hasWorkspace: boolean
  /** 侧栏换脸(设置导航/UI 工作台左侧栏)时,搜索/前进后退/刷新都是文件树的家务,置灰 */
  fileNavOff?: boolean
  /** 侧栏这一列此刻露着 = 搜索框/导航组才营业(收起时整组消失,规格 §4.3) */
  sidebarShown: boolean
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  nav: { stack: NavLocation[]; index: number }
  goNav: (delta: number) => Promise<void>
  handleRefresh: () => Promise<void>
  /** 刷新进行中:刷新钮图标转圈(至少转满一圈,结果由 Toast 回报) */
  refreshing: boolean
  filter: string
  onFilterChange: (v: string) => void
  /** Chrome 页签带(B3):App 按页签组算好条带宽度递进来;
      空/没项目时不递,页签区就是一条可拖窗的空白面 */
  tabs?: React.ReactNode
}): React.JSX.Element {
  const maximized = useWindowMaximized()
  const searchRef = useRef<HTMLInputElement>(null)
  const fitted = useFittedPlaceholder(searchRef, !hasWorkspace)
  return (
    // 顶栏死空间拖窗/双击最大化走手动引擎:原生 app-region:drag 会吃 Windows
    // Aero Shake(摇窗最小化其它窗,产品指定要哑火);可交互件(按钮/输入框/
    // 页签带)一律不接管,各自的点击与页签拖拽照常
    <header
      className="topbar"
      onPointerDown={(e) => {
        if (isDeadSpace(e.target)) startWindowDrag(e)
      }}
      onDoubleClick={(e) => {
        if (isDeadSpace(e.target)) void window.atlas.windowMaximizeToggle()
      }}
    >
      <div className={`topbar-side${sidebarShown ? '' : ' is-bare'}`}>
        {/* 收起侧栏:顶栏最左端,独占 1u 列,图标骑 rail 中线(x=0.5u) */}
        <div className="tb-collapse">
          <button
            type="button"
            className="tb-btn"
            onClick={onToggleSidebar}
            /* 侧栏常驻(v3:首页就是「这台电脑」),有没有项目都能收起;只在扫描期禁动 */
            disabled={scanning}
            data-tip={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            aria-pressed={sidebarCollapsed}
          >
            <TreeIcon name="panelLeft" size={TOP_ICON} strokeWidth={TOP_ICON_STROKE} mono />
          </button>
        </div>
        {sidebarShown && (
          <>
            {/* 工作区文件名搜索:B1 先接旧的树内过滤,深搜升级在 B7 */}
            <label className={`tb-search${fitted.tight ? ' is-tight' : ''}`}>
              <TreeIcon name="search" size={TOP_ICON} strokeWidth={TOP_ICON_STROKE} mono />
              <input
                ref={searchRef}
                type="search"
                value={filter}
                placeholder={hasWorkspace ? '搜索文件' : fitted.text}
                aria-label="搜索文件"
                spellCheck={false}
                disabled={!hasWorkspace || fileNavOff}
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
                disabled={scanning || fileNavOff || nav.index <= 0}
                data-tip="后退"
                aria-label="后退"
              >
                <IconArrowLeft size={TOP_ICON} strokeWidth={TOP_ICON_STROKE} mono />
              </button>
              <button
                type="button"
                className="tb-btn"
                onClick={() => void goNav(1)}
                disabled={scanning || fileNavOff || nav.index >= nav.stack.length - 1}
                data-tip="前进"
                aria-label="前进"
              >
                <IconArrowRight size={TOP_ICON} strokeWidth={TOP_ICON_STROKE} mono />
              </button>
              <button
                type="button"
                className={`tb-btn${refreshing ? ' is-spinning' : ''}`}
                onClick={() => void handleRefresh()}
                disabled={scanning || fileNavOff}
                data-tip={scanning ? '扫描中……' : '刷新'}
                aria-label="刷新"
              >
                <IconRefresh size={REFRESH_ICON} strokeWidth={TOP_ICON_STROKE} mono />
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
          className="win-btn"
          onClick={() => void window.atlas.windowMinimize()}
          data-tip="最小化"
          aria-label="最小化"
        >
          <TreeIcon name="minus" size={WIN_ICON_SIZE} mono />
        </button>
        <button
          type="button"
          className="win-btn"
          onClick={() => void window.atlas.windowMaximizeToggle()}
          data-tip={maximized ? '还原' : '最大化'}
          aria-label={maximized ? '还原' : '最大化'}
        >
          <TreeIcon name={maximized ? 'restore' : 'maximize'} size={WIN_ICON_SIZE} mono />
        </button>
        <button
          type="button"
          className="win-btn win-close"
          onClick={() => void window.atlas.windowClose()}
          data-tip="关闭"
          aria-label="关闭"
        >
          <TreeIcon name="x" size={WIN_ICON_SIZE} mono />
        </button>
      </div>
    </header>
  )
}
