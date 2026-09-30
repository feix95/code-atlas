import { useLayoutEffect, useRef, useState } from 'react'
import { TreeIcon } from './Icons'
import { isFileKind, type PaneKind } from '../paneKinds'
import { canReadingMode, type PaneViewMode } from '../paneTabs'
import { MENU_SEP, openContextMenu, type ContextMenuEntry } from './contextMenuStore'
import { hostNameOf, startWindowDrag } from '../windowDrag'

/** 页签条对外的页签形状(App 的 PaneTab 投影,这里不关心对话账本那些私事) */
export interface TabBarTab {
  id: string
  kind: PaneKind
  name: string
  icon: string
  /** 文件签的文件 relPath(右键菜单的文件动作要它):单例签为空串 */
  relPath: string
  /** peek 签的读根(盘符下钻):复制路径/资源管理器按它拼绝对路径 */
  scopeRoot?: string
  /** 文件签的看片档位(阅读模式这锤):菜单里给当前档打勾 */
  viewMode?: PaneViewMode
}

/**
 * 页签条(小葵的页签模型·文件签版):一张页签 = 图标 + 名字 + 悬停才出现的 ×。
 * 文件签脸就是文件名;单例签挂品类名牌。拖拽走 TopBarTabs 的 pointer 引擎:
 * 这里只上报 pointerdown 和画让位缝 —— 被拖的签全程保持原样(小葵拍板),
 * 缝用 margin 过渡撑开(VS Code 式让位手感)。
 * 中键点页签 = 关闭。右键菜单走全局通用 ContextMenu(Obsidian 式分组,组间细线)。
 * 页签尾空白的拖窗走 windowDrag.ts 的手动搬窗引擎
 * (顶栏死空间/日志窗头条共用同一套)。
 */
/** 本组条带内的活序滑动账(Chromium 桌面模型):被拖签真身 translateX 跟指针滑,
   邻居在落点序号变化时 translateX 滑进腾出的格子 —— 条带全程满编,没有缝没有线;
   别家条带拿不到它(那边仍走 margin 缝+插入线预览) */
export interface TabSlide {
  /** 被拖签 id(本组必有) */
  srcId: string
  /** 源签原位的左缘(视口 x):translateX 的基准 */
  slotLeft: number
  /** 源签宽:空槽穿身而过,补位邻居一律横移这个量(与自身宽窄无关) */
  srcW: number
  grabDx: number
  /** 指针当前 x(视口) */
  x: number
  /** 落点序号(剔除源签后的可见序);null = 指针不在本带 → 全员滑回家位 */
  idx: number | null
  /** 滑动夹持边界:本带首签左缘 ~ 末签右缘 */
  minL: number
  maxR: number
}

export function TabBar({
  tabs,
  activeId,
  flashId,
  canMoveToSiblingGroup,
  onActivate,
  onClose,
  onCloseMany,
  onMoveTab,
  onDetachTab,
  onSetViewMode,
  onRevealInTree,
  workspaceRoot,
  dragSourceId,
  gapIndex,
  gapWidth,
  slide,
  onTabPointerDown
}: {
  tabs: TabBarTab[]
  activeId: string | null
  /** 需要指路时刚点名的那张页签:轻强调一下,让用户察觉它在那 */
  flashId: string | null
  /** 拖拽/右键「挪组」时有没有另一组可去(单组时提供「往左/右拆一组」的路) */
  canMoveToSiblingGroup: boolean
  onActivate: (id: string) => void
  onClose: (id: string) => void
  /** 批量关签(右键「关其他/关右侧/关全部」):报本带内要被清掉的签 id 清单 */
  onCloseMany?: (ids: string[]) => void
  /** 挪页签(右键菜单走这条路;拖拽的落点账在 TopBarTabs 引擎里算) */
  onMoveTab: (
    id: string,
    toGroup: 'sibling' | null,
    atIndex: number | null,
    splitSide?: 'left' | 'right'
  ) => void
  /** 右键菜单「移到新窗口」:不拖也撕(页签撕窗锤),所有页签一视同仁 */
  onDetachTab?: (id: string) => void
  /** 右键菜单「阅读/源码模式」:切文件签的看片档位 */
  onSetViewMode?: (id: string, mode: PaneViewMode) => void
  /** 右键菜单「在文件列表中显示当前文件」:回侧栏树里选中+展开父链(工作区签才有) */
  onRevealInTree?: (id: string) => void
  /** 工作区根(文件动作的拼路径底):peek 签自带 scopeRoot,不看这里 */
  workspaceRoot?: string | null
  /** 正被 pointer 引擎拎着的页签 id:本组走活序滑动、别家条带拿它判缝归属 */
  dragSourceId: string | null
  /** 落点缝的序号(按剔除被拖签后的可见序):缝 = 那张签的 margin-left 撑开;
      只递别家条带,本组滑动模型不撑缝 */
  gapIndex: number | null
  gapWidth: number
  /** 本组活序滑动账(只在被拖签的家这条带递):null = 不走滑动模型 */
  slide: TabSlide | null
  /** 页签 pointerdown 上报给引擎:按住够阈值它来接管成拖拽会话 */
  onTabPointerDown: (e: React.PointerEvent<HTMLDivElement>, t: TabBarTab) => void
}): React.JSX.Element {
  /**
   * 连点关签的冻结宽(Chrome/Edge 同款手感):签是 flex 平分宽,关一张剩下就变宽,
   * × 跟着右漂,原地连点就点空。关签前把当前渲染宽锁成固定值,后面的签顶上来
   * × 还在原地;鼠标离开页签带才解冻,宽度回到 flex 分摊。
   * 锁的是关闭前一刻的实测宽(getBoundingClientRect),不是 CSS 理论值。
   */
  const [frozenW, setFrozenW] = useState<number | null>(null)
  // 解冻回弹动画的户口:进行中的补帧在再关签/重进带时先取消,别让旧动画顶着新冻结跑
  const releaseAnims = useRef<Animation[]>([])

  function freezeAndClose(id: string, tabEl: HTMLElement): void {
    releaseAnims.current.forEach((a) => a.cancel())
    releaseAnims.current = []
    const w = tabEl.getBoundingClientRect().width
    if (w > 0) setFrozenW(w)
    onClose(id)
  }

  /**
   * 解冻回弹(FLIP + 弹性 ease):mouseleave 时先记下每签冻结宽存进 ref,
   * 解冻后的 layout effect(DOM 已落账、还没上屏)量出 flex 分摊的真实终点,
   * 再用 WAAPI 从「旧宽 + 不生长」补帧到「basis 0 + 生长」——动画第 0 帧
   * 就是冻结宽,全程无跳变;easing 尾部过冲让宽度带一点弹簧感。
   * (不在 CSS 挂过渡,也不能 rAF 量:flex 项终点宽是布局算的;rAF 会抢在
   *  React 提交前量,拿到旧值直接跳过 —— 实测踩过,勿改回)
   */
  const pendingRelease = useRef<{ els: HTMLElement[]; before: number[] } | null>(null)
  function releaseFreeze(e: React.MouseEvent<HTMLDivElement>): void {
    if (frozenW === null) return
    const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.tabbar-tab'))
    pendingRelease.current = { els, before: els.map((el) => el.getBoundingClientRect().width) }
    setFrozenW(null)
  }
  useLayoutEffect(() => {
    if (frozenW !== null || !pendingRelease.current) return
    const { els, before } = pendingRelease.current
    pendingRelease.current = null
    els.forEach((el, i) => {
      if (!el.isConnected) return
      const after = el.getBoundingClientRect().width
      if (Math.abs(after - before[i]) < 1) return
      releaseAnims.current.push(
        el.animate(
          [
            { flexGrow: '0', flexBasis: `${before[i]}px` },
            { flexGrow: '1', flexBasis: '0px' }
          ],
          { duration: 320, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' }
        )
      )
    })
  }, [frozenW])

  /**
   * 页签右键菜单(Obsidian 式分组,阅读模式这锤):走全局通用菜单,
   * 组间一道细线;行内图标 + 「当前档」行尾勾。菜单行按签品类现拼:
   * 单例签没有文件动作和看片档;非 md 文件签的「阅读模式」灰挂 tip(禁用优于隐藏,
   * 菜单形状稳定+功能可发现);peek 签没有树定位。
   * realm 铁律:doc 记进请求,菜单开在子窗时它自己窗内那台接活。
   */
  function openTabMenu(e: React.MouseEvent, t: TabBarTab): void {
    e.preventDefault()
    e.stopPropagation()
    const doc = (e.currentTarget as HTMLElement).ownerDocument
    const isFile = isFileKind(t.kind)
    const root = t.scopeRoot ?? workspaceRoot ?? null
    const items: ContextMenuEntry[] = []

    items.push({ label: '关闭页签', icon: 'x', run: () => onClose(t.id) })

    // 批量关签(和关单签同组):只剩这一张时「其他」灰挂,菜单形状稳定
    if (onCloseMany) {
      const otherIds = tabs.filter((x) => x.id !== t.id).map((x) => x.id)
      items.push(
        {
          label: '关闭其他页签',
          icon: 'sidesX',
          disabled: otherIds.length === 0,
          run: () => onCloseMany(otherIds)
        },
        {
          label: '关闭全部页签',
          icon: 'xSquare',
          disabled: tabs.length === 0,
          run: () => onCloseMany(tabs.map((x) => x.id))
        }
      )
    }

    // 看片档(文件签常驻):当前档行尾打勾,点另一档切过去;
    // 非 md 文件签的「阅读模式」灰挂「Markdown 文件专属」tip —— 勾钉源码档,系统状态不说谎
    if (isFile) {
      const readable = canReadingMode(t.relPath)
      const readingOn = readable && (t.viewMode ?? 'source') === 'reading'
      items.push(
        MENU_SEP,
        {
          label: '阅读模式',
          icon: 'bookOpen',
          checked: readingOn,
          disabled: !readable,
          tip: readable ? undefined : 'Markdown 文件专属',
          run: () => onSetViewMode?.(t.id, 'reading')
        },
        {
          label: '源码模式',
          icon: 'code',
          checked: !readingOn,
          run: () => onSetViewMode?.(t.id, 'source')
        }
      )
    }

    if (onDetachTab)
      items.push(MENU_SEP, {
        label: '移到新窗口',
        icon: 'appWindow',
        run: () => onDetachTab(t.id)
      })

    // 分组组:已有另一组就「挪过去」;单组才分向拆(独签一组拆不出第二组,灰着)
    if (canMoveToSiblingGroup)
      items.push(MENU_SEP, {
        label: '移到另一组',
        icon: 'arrows',
        run: () => onMoveTab(t.id, 'sibling', null)
      })
    else {
      const lonely = tabs.length < 2
      items.push(
        MENU_SEP,
        {
          label: '向左拆分',
          icon: 'panelLeft',
          disabled: lonely,
          run: () => onMoveTab(t.id, 'sibling', null, 'left')
        },
        {
          label: '向右拆分',
          icon: 'panelRight',
          disabled: lonely,
          run: () => onMoveTab(t.id, 'sibling', null, 'right')
        }
      )
    }

    // 文件动作组:复制路径自成一组,资源管理器/树定位一组(沿用截图的分组)
    if (isFile && root !== null) {
      items.push(
        MENU_SEP,
        {
          label: '复制路径',
          icon: 'copy',
          run: async () => {
            const r = await window.atlas.copyFilePath(root, t.relPath)
            return r.ok ? '已复制 ✓' : (r.message ?? '没复制成')
          }
        },
        MENU_SEP,
        {
          label: '在文件资源管理器中显示',
          icon: 'folder',
          run: async () => {
            const r = await window.atlas.revealFilePath(root, t.relPath)
            return r.ok ? undefined : (r.message ?? '没打开成')
          }
        }
      )
      // peek 签的文件不归工作区树管,树定位不摆
      if (t.kind === 'preview' && onRevealInTree)
        items.push({
          label: '在文件列表中显示当前文件',
          icon: 'crosshair',
          run: () => onRevealInTree(t.id)
        })
    }

    openContextMenu({ x: e.clientX, y: e.clientY, doc, items })
  }

  // 落点缝的落法:缝序号按「剔除被拖签」的可见序 —— 缝前那张签吃 margin-left,
  // 缝在末尾时最后一张吃 margin-right(空白带本来就是空地,但划道缝更明确)。
  // margin 缝只在别家条带唱戏:本组走活序滑动,源签真身自己就是占位的那个
  const effTabs = dragSourceId ? tabs.filter((t) => t.id !== dragSourceId) : tabs
  const srcIdx = dragSourceId ? tabs.findIndex((t) => t.id === dragSourceId) : -1
  const gapOn = gapIndex !== null && srcIdx === -1
  const gapAnchor = gapOn ? effTabs[gapIndex] : undefined
  const gapTail = gapOn && !gapAnchor ? effTabs[effTabs.length - 1] : undefined
  // 插入线宿主(Obsidian 式):钉在「它要跟在后面的那张签」的尾巴缘上,签被 flex
  // 挤着换位置线跟着走 —— 全局坐标在 margin 动画下会漂,寄生签身上视觉=真实恒成立;
  // 缝在队首时寄生首签的前缘
  const markHost = gapOn ? (effTabs[gapIndex - 1] ?? effTabs[0]) : undefined
  const markBefore = gapIndex === 0
  // 活序滑动的落点序号:指针不在本带(slide.idx=null)视为回家 —— 邻居全滑回原位
  const landIdx = slide?.idx ?? srcIdx

  return (
    <div
      className={`tabbar${dragSourceId ? ' is-dnd-live' : ''}`}
      role="tablist"
      aria-label="已打开的页签"
      onMouseLeave={releaseFreeze}
    >
      {tabs.map((t, k) => {
        // 活序滑动几何:源签跟指针横移(夹在本带首尾内),邻居按落点序号滑动补位 —
        // 空槽(一个源签宽)穿身而过,与自身宽窄无关;序号==家位时全员 delta=0
        const isSlideSrc = slide !== null && t.id === slide.srcId
        let tx = 0
        if (slide) {
          if (isSlideSrc) {
            if (slide.idx !== null) {
              const left = Math.min(
                Math.max(slide.x - slide.grabDx, slide.minL),
                slide.maxR - slide.srcW
              )
              tx = left - slide.slotLeft
            }
          } else {
            const p = k < srcIdx ? k : k - 1
            const dest = p < landIdx ? p : p + 1
            tx = (dest - k) * slide.srcW
          }
        }
        return (
          <div
            key={t.id}
            role="tab"
            tabIndex={0}
            aria-selected={t.id === activeId}
            className={`tabbar-tab${t.id === activeId ? ' is-active' : ''}${
              t.id === flashId ? ' is-flash' : ''
            }${isSlideSrc ? ' is-drag-src' : ''}`}
            data-tab-id={t.id}
            style={{
              // 冻结态:签宽锁成关签前实测值(flex-basis 定死,不再分摊),
              // 空白全推给 .tabbar-blank 吃 —— × 原地不动,连点不漂
              ...(frozenW !== null ? { flex: `0 0 ${frozenW}px` } : {}),
              ...(t.id === gapAnchor?.id ? { marginLeft: gapWidth } : {}),
              ...(t.id === gapTail?.id ? { marginRight: gapWidth } : {}),
              ...(tx !== 0 ? { transform: `translateX(${tx}px)` } : {})
            }}
            onPointerDown={(e) => onTabPointerDown(e, t)}
            onClick={() => onActivate(t.id)}
            onContextMenu={(e) => openTabMenu(e, t)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onActivate(t.id)
              }
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                freezeAndClose(t.id, e.currentTarget)
              }
            }}
          >
            <span className="tabbar-icon" aria-hidden="true">
              <TreeIcon name={t.icon} mono />
            </span>
            <span className="tabbar-name">{t.name}</span>
            <button
              type="button"
              className="tabbar-close"
              aria-label={`关闭 ${t.name}`}
              onClick={(e) => {
                e.stopPropagation()
                const tabEl = e.currentTarget.closest('.tabbar-tab')
                if (tabEl instanceof HTMLElement) freezeAndClose(t.id, tabEl)
                else onClose(t.id)
              }}
            >
              ✕
            </button>
            {/* 插入线寄生宿主签:后缘宿主钉右缘,队首缝钉首签左缘 */}
            {markHost?.id === t.id && (
              <i className={`tabbar-insert${markBefore ? ' is-before' : ''}`} aria-hidden="true" />
            )}
          </div>
        )
      })}
      {/* 页签卡之间的空白:拖页签扫到这 = 落本组末尾(引擎按中线序判,空白不用自己接);
          左键按住拖 = 手动搬窗(等价原生 drag 面,主窗子窗都吃这套 —— 引擎报户口),
          双击 = 最大化/还原 */}
      <div
        className="tabbar-blank"
        onPointerDown={startWindowDrag}
        onDoubleClick={(e) => void window.atlas.windowMaximizeToggle(hostNameOf(e.currentTarget))}
        aria-hidden="true"
      />
    </div>
  )
}
