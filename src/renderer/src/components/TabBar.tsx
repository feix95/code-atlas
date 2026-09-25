import { useCallback, useState } from 'react'
import { DRAG_MIME_TAB } from '@shared/dragTypes'
import { TreeIcon } from './Icons'
import { KIND_LABELS, KIND_ORDER, type PaneKind } from '../paneKinds'
import { useMenuDismiss } from '../useMenuDismiss'

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
 * 页签可以拖:拖到别的页签上换位置,拖到另一组的页签栏/正文里就是搬家(积木式拼装)。
 * 中键点页签 = 关闭。页签多了横向滚。
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
  onDragTab,
  onTabDragEnd,
  onDetachTab,
  enabledKinds,
  onToggleKind
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
  /** 挪页签:toGroup 空 = 另一组(单组时=往右拆新组); atIndex 空 = 放到那组末尾 */
  onMoveTab: (id: string, toGroup: 'sibling' | null, atIndex: number | null) => void
  /** 拖动开始/结束喊一声(App 要知道谁在拖,好判定「中心分屏」该不该许诺) */
  onDragTab: (id: string | null) => void
  /** 拖动落定喊一声是哪张(走出面板锤:拖出主窗松手 = 放出小探针,App 拿它判品类) */
  onTabDragEnd?: (id: string) => void
  /** 右键菜单「放到桌面」:不拖也放(走出面板锤补,小葵点的名),只对小探针页签显示 */
  onDetachTab?: (id: string) => void
  enabledKinds: Set<PaneKind>
  onToggleKind: (kind: PaneKind, on: boolean) => void
}): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // 页签上的右键菜单:挪组 / 关闭(记下是哪张页签)
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  // 拖拽悬停的目标页签:画一条左边线提示「会插到它前面」
  const [dropBefore, setDropBefore] = useState<string | null>(null)
  const [dropZone, setDropZone] = useState(false)
  // 拖动中的页签(本组还是别组,松手时要知道:拖回自己组的空白 = 挪到本组末尾,不是搬家)
  const [draggingId, setDraggingId] = useState<string | null>(null)
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

  return (
    <div
      className={`tabbar${dropZone ? ' is-drop-zone' : ''}`}
      role="tablist"
      aria-label="已打开的页签"
      onDragOver={(e) => {
        // 拖着页签扫过整条页签栏(含空白):按住入场券,松手落到这组末尾
        if (e.dataTransfer.types.includes(DRAG_MIME_TAB)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropBefore(null)
        }
      }}
    >
      {tabs.map((t) => {
        const title = t.pinned
          ? t.kind === 'chat'
            ? `${t.name} —— 这页对话钉住了,树里换文件它不动;对话没了就是没了,关页签前想好`
            : `${t.name} —— 已钉住,树里换文件它不动;双击可以取消钉住`
          : `${t.name} —— 跟着左侧树走,点谁它显示谁;双击钉住`
        return (
          <div
            key={t.id}
            role="tab"
            tabIndex={0}
            aria-selected={t.id === activeId}
            className={`tabbar-tab${t.id === activeId ? ' is-active' : ''}${t.pinned ? ' is-pinned' : ' is-follow'}${
              t.id === flashId ? ' is-flash' : ''
            }${dropBefore === t.id ? ' is-drop-before' : ''}`}
            title={title}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME_TAB, t.id)
              e.dataTransfer.effectAllowed = 'move'
              setDraggingId(t.id)
              onDragTab(t.id)
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_MIME_TAB)) {
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                setDropBefore(t.id)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const id = e.dataTransfer.getData(DRAG_MIME_TAB)
              setDropBefore(null)
              setDropZone(false)
              if (id && id !== t.id) {
                const at = tabs.findIndex((x) => x.id === t.id)
                onMoveTab(id, null, at === -1 ? null : at)
              }
            }}
            onDragEnd={() => {
              setDropBefore(null)
              setDropZone(false)
              setDraggingId(null)
              onDragTab(null)
              // 落定上报:拖出主窗放出小探针这类「落点语义」由 App 判,这里只报是谁
              onTabDragEnd?.(t.id)
            }}
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
              title="关闭"
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
      {/* 页签卡之间的空白:右键弹品类菜单(小葵图里的「空白区域」);也是拖页签搬家的落点。
          自己组的页签拖回来 = 挪到本组末尾;别组的页签 = 搬家 */}
      <div
        className="tabbar-blank"
        onContextMenu={openKindMenu}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_MIME_TAB)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropZone(true)
            setDropBefore(null)
          }
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(DRAG_MIME_TAB)
          setDropZone(false)
          if (id) onMoveTab(id, draggingId === id ? null : 'sibling', null)
        }}
        onDragLeave={() => setDropZone(false)}
        aria-hidden="true"
      />
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
          {(() => {
            const t = tabs.find((x) => x.id === tabMenu.tabId)
            return t?.kind === 'chat' && !t.pinned ? (
              <button
                type="button"
                role="menuitem"
                className="kindmenu-item"
                onClick={() => {
                  onDetachTab?.(t.id)
                  setTabMenu(null)
                }}
              >
                把小探针放到桌面上
              </button>
            ) : null
          })()}
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
