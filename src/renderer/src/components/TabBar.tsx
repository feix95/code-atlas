import { useCallback, useState } from 'react'
import { TreeIcon } from './Icons'
import { isMenuKind, KIND_LABELS, KIND_ORDER, type PaneKind } from '../paneKinds'
import { useMenuDismiss } from '../useMenuDismiss'
import { startWindowDrag } from '../windowDrag'

/** 页签条对外的页签形状(App 的 PaneTab 投影,这里不关心对话账本那些私事) */
export interface TabBarTab {
  id: string
  kind: PaneKind
  name: string
  icon: string
  pinned: boolean
}

/**
 * 页签条(小葵的页签模型):一张页签 = 图标 + 名字 + 悬停才出现的 ×。
 * 钉住的页签最左换成图钉小图标(她图的「左上角 pin icon」),树里换文件它不动;
 * 没钉的页签跟着左侧树走,点谁显示谁。页签卡之间的空白区域右键,
 * 弹品类菜单:勾选 = 显示这个品类的页签,不选 = 藏起来(全局开关,记进本机)。
 * 拖拽走 TopBarTabs 的 pointer 引擎:这里只上报 pointerdown 和画让位缝 ——
 * 被拖的签原地塌缩成空位,缝用 margin 过渡撑开(VS Code 式让位手感)。
 * 中键点页签 = 关闭。页签尾空白的拖窗走 windowDrag.ts 的手动搬窗引擎
 * (顶栏死空间/日志窗头条共用同一套)。
 */

export function TabBar({
  tabs,
  activeId,
  flashId,
  canMoveToSiblingGroup,
  onActivate,
  onClose,
  onPinToggle,
  onMoveTab,
  onDetachTab,
  enabledKinds,
  onToggleKind,
  dragSourceId,
  gapIndex,
  gapWidth,
  insertX,
  onTabPointerDown
}: {
  tabs: TabBarTab[]
  activeId: string | null
  /** 系统自动勾回品类时刚点亮的那张页签:轻强调一下,让用户察觉「设置刚被自动改了」 */
  flashId: string | null
  /** 拖拽/右键「挪组」时有没有另一组可去(单组时提供「往右拆一组」的路) */
  canMoveToSiblingGroup: boolean
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onPinToggle: (id: string) => void
  /** 挪页签(右键菜单走这条路;拖拽的落点账在 TopBarTabs 引擎里算) */
  onMoveTab: (id: string, toGroup: 'sibling' | null, atIndex: number | null) => void
  /** 右键菜单「放到桌面」:不拖也放(走出面板锤补,小葵点的名),只对小探针页签显示 */
  onDetachTab?: (id: string) => void
  enabledKinds: Set<PaneKind>
  onToggleKind: (kind: PaneKind, on: boolean) => void
  /** 正被 pointer 引擎拎着的页签 id:它在这条带里原地塌缩成空位 */
  dragSourceId: string | null
  /** 落点缝的序号(按剔除被拖签后的可见序):缝 = 那张签的 margin-left 撑开 */
  gapIndex: number | null
  gapWidth: number
  /** 蓝色插入线的带内 x(px):钉在缝口上告诉用户「会插到这」 */
  insertX: number | null
  /** 页签 pointerdown 上报给引擎:按住够阈值它来接管成拖拽会话 */
  onTabPointerDown: (e: React.PointerEvent<HTMLDivElement>, t: TabBarTab) => void
}): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // 页签上的右键菜单:挪组 / 关闭(记下是哪张页签)
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const closeMenus = useCallback((): void => {
    setMenu(null)
    setTabMenu(null)
  }, [])

  // 点页面任何地方/滚轮/按 Esc 都收菜单;菜单内部点选不算「外面」
  useMenuDismiss(menu !== null || tabMenu !== null, closeMenus, '.tabbar-kindmenu')

  function openKindMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setTabMenu(null)
    // 菜单按视口坐标 fixed 摆放(不吃页签条横向滚动的裁剪),快贴到右/下缘时往回收一点
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - 170)
    })
  }

  function openTabMenu(e: React.MouseEvent, tabId: string): void {
    e.preventDefault()
    e.stopPropagation()
    setMenu(null)
    setTabMenu({
      x: Math.min(e.clientX, window.innerWidth - 190),
      y: Math.min(e.clientY, window.innerHeight - 130),
      tabId
    })
  }

  // 落点缝的落法:缝序号按「剔除被拖签」的可见序 —— 缝前那张签吃 margin-left,
  // 缝在末尾时最后一张吃 margin-right(空白带本来就是空地,但划道缝更明确)
  const effTabs = dragSourceId ? tabs.filter((t) => t.id !== dragSourceId) : tabs
  const gapAnchor = gapIndex !== null ? effTabs[gapIndex] : undefined
  const gapTail = gapIndex !== null && !gapAnchor ? effTabs[effTabs.length - 1] : undefined
  // 右键菜单里点名的那张签:钉住/取消钉住、放到桌面这些「对谁动手」的项都按它判
  const menuTab = tabMenu ? (tabs.find((x) => x.id === tabMenu.tabId) ?? null) : null

  return (
    <div
      className={`tabbar${dragSourceId ? ' is-dnd-live' : ''}`}
      role="tablist"
      aria-label="已打开的页签"
    >
      {tabs.map((t) => {
        return (
          <div
            key={t.id}
            role="tab"
            tabIndex={0}
            aria-selected={t.id === activeId}
            className={`tabbar-tab${t.id === activeId ? ' is-active' : ''}${t.pinned ? ' is-pinned' : ' is-follow'}${
              t.id === flashId ? ' is-flash' : ''
            }${t.id === dragSourceId ? ' is-drag-source' : ''}`}
            data-tab-id={t.id}
            style={
              t.id === gapAnchor?.id
                ? { marginLeft: gapWidth }
                : t.id === gapTail?.id
                  ? { marginRight: gapWidth }
                  : undefined
            }
            onPointerDown={(e) => onTabPointerDown(e, t)}
            onClick={() => onActivate(t.id)}
            onDoubleClick={() => onPinToggle(t.id)}
            onContextMenu={(e) => openTabMenu(e, t.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onActivate(t.id)
              }
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                onClose(t.id)
              }
            }}
          >
            <span className="tabbar-icon" aria-hidden="true">
              <TreeIcon name={t.pinned ? 'pin' : t.icon} mono />
            </span>
            <span className="tabbar-name">{t.name}</span>
            <button
              type="button"
              className="tabbar-close"
              aria-label={`关闭 ${t.name}`}
              data-tip="关闭"
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.id)
              }}
            >
              ✕
            </button>
          </div>
        )
      })}
      {/* 页签卡之间的空白:右键弹品类菜单(小葵图里的「空白区域」);
          拖页签扫到这 = 落本组末尾(引擎按中线序判,空白不用自己接);
          左键按住拖 = 手动搬窗(等价原生 drag 面),双击 = 最大化/还原 */}
      <div
        className="tabbar-blank"
        onContextMenu={openKindMenu}
        onPointerDown={startWindowDrag}
        onDoubleClick={() => void window.atlas.windowMaximizeToggle()}
        aria-hidden="true"
      />
      {/* 插入线:钉在落点缝口上的主题色竖线,光标一动跟缝一起滑(Edge 式提示) */}
      {insertX !== null && (
        <div className="tabbar-insert" style={{ left: insertX }} aria-hidden="true" />
      )}
      {menu && (
        <div
          className="tabbar-kindmenu"
          role="menu"
          aria-label="页签品类开关"
          style={{ left: menu.x, top: menu.y }}
        >
          <p className="kindmenu-title">勾选的功能页才显示</p>
          {KIND_ORDER.map((k) => {
            const on = enabledKinds.has(k)
            return (
              <button
                key={k}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                className={`kindmenu-item${on ? ' is-on' : ''}`}
                onClick={() => {
                  onToggleKind(k, !on)
                  // 选完就收(小葵拍的):勾一个/取消一个,菜单自己走,不用再点外面
                  setMenu(null)
                }}
              >
                <span className="kindmenu-check" aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
                {KIND_LABELS[k]}
              </button>
            )
          })}
          <p className="kindmenu-note">以后出新功能页,也在这里勾</p>
        </div>
      )}
      {tabMenu && (
        <div
          className="tabbar-kindmenu"
          role="menu"
          aria-label="页签操作"
          style={{ left: tabMenu.x, top: tabMenu.y }}
        >
          {menuTab && isMenuKind(menuTab.kind) && (
            // 钉住/取消钉住的明门:双击是暗门,菜单给条能发现的路;
            // 钉住的对话签点了走 pinToggleTab 的拒绝路 —— 浮条会说为什么不行
            <button
              type="button"
              role="menuitem"
              className="kindmenu-item"
              onClick={() => {
                onPinToggle(menuTab.id)
                setTabMenu(null)
              }}
            >
              {menuTab.pinned ? '取消钉住' : '钉住页签'}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="kindmenu-item"
            onClick={() => {
              onMoveTab(tabMenu.tabId, 'sibling', null)
              setTabMenu(null)
            }}
          >
            {canMoveToSiblingGroup ? '挪去另一组' : '挪去右边,拆成两组'}
          </button>
          {menuTab?.kind === 'chat' && !menuTab.pinned && (
            <button
              type="button"
              role="menuitem"
              className="kindmenu-item"
              onClick={() => {
                onDetachTab?.(menuTab.id)
                setTabMenu(null)
              }}
            >
              把小探针放到桌面上
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="kindmenu-item kindmenu-item-danger"
            onClick={() => {
              onClose(tabMenu.tabId)
              setTabMenu(null)
            }}
          >
            关闭页签
          </button>
        </div>
      )}
    </div>
  )
}
