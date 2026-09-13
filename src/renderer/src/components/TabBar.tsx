import { useEffect, useState } from 'react'
import { TreeIcon } from './Icons'
import { KIND_LABELS, KIND_ORDER, type PaneKind } from '../paneKinds'

/**
 * 页签条(小葵的页签模型):一张页签 = 图标 + 名字 + 悬停才出现的 ×。
 * 钉住的页签最左换成图钉小图标(她图的「左上角 pin icon」),树里换文件它不动;
 * 没钉的页签跟着左侧树走,点谁显示谁。页签卡之间的空白区域右键,
 * 弹品类菜单:勾选 = 显示这个品类的页签,不选 = 藏起来(全局开关,记进本机)。
 * 中键点页签 = 关闭。页签多了横向滚。
 */
export function TabBar({
  tabs,
  activeId,
  flashId,
  onActivate,
  onClose,
  onPinToggle,
  enabledKinds,
  onToggleKind
}: {
  tabs: Array<{ id: string; kind: PaneKind; name: string; icon: string; pinned: boolean }>
  activeId: string | null
  /** 系统自动勾回品类时刚点亮的那张页签:轻强调一下,让用户察觉「设置刚被自动改了」 */
  flashId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onPinToggle: (id: string) => void
  enabledKinds: Set<PaneKind>
  onToggleKind: (kind: PaneKind, on: boolean) => void
}): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // 点页面任何地方/按 Esc 都收菜单;菜单内部点选不算「外面」(mousedown 先拦住)
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  function openMenu(e: React.MouseEvent): void {
    e.preventDefault()
    // 菜单按视口坐标 fixed 摆放(不吃页签条横向滚动的裁剪),快贴到右/下缘时往回收一点
    const x = Math.min(e.clientX, window.innerWidth - 200)
    const y = Math.min(e.clientY, window.innerHeight - 170)
    setMenu({ x, y })
  }

  return (
    <div className="tabbar" role="tablist" aria-label="已打开的页签">
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
            }`}
            title={title}
            onClick={() => onActivate(t.id)}
            onDoubleClick={() => onPinToggle(t.id)}
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
              <TreeIcon name={t.pinned ? 'pin' : t.icon} />
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
      {/* 页签卡之间的空白:右键弹品类菜单(小葵图里的「空白区域」) */}
      <div className="tabbar-blank" onContextMenu={openMenu} aria-hidden="true" />
      {menu && (
        <div
          className="tabbar-kindmenu"
          role="menu"
          aria-label="页签品类开关"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
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
                onClick={() => onToggleKind(k, !on)}
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
    </div>
  )
}
