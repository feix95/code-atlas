// 左栏顶卡 = 浏览器地址栏:点卡任意处 = 聚焦输入框 + 弹出工作区菜单;⇅ 是明确的开关。
import { useEffect, useState } from 'react'
import { menuWorkspaceRows, type RecentProject } from '../recents'
import { useMenuDismiss } from '../useMenuDismiss'
import { openTextEditMenu } from './textEditMenu'
import { WorkspaceMenu } from './WorkspaceMenu'

/** 地址栏顶卡:输路径回车即开,⇅ 弹最近工作区(菜单内分 pin / 历史两区) */
export function WorkspacePathCard({
  folder,
  scanning,
  pathDraft,
  pathHint,
  pathShaking,
  pathInputRef,
  setPathDraft,
  setPathShaking,
  dismissPathHint,
  goPath,
  recents,
  onOpenWorkspace,
  onTogglePin,
  onRemoveRecent,
  onGoHome
}: {
  folder: string | null
  scanning: boolean
  pathDraft: string
  pathHint: string | null
  pathShaking: boolean
  pathInputRef: React.RefObject<HTMLInputElement | null>
  setPathDraft: React.Dispatch<React.SetStateAction<string>>
  setPathShaking: React.Dispatch<React.SetStateAction<boolean>>
  dismissPathHint: () => void
  goPath: () => Promise<void>
  recents: RecentProject[]
  onOpenWorkspace: (path: string) => void
  onTogglePin: (path: string) => void
  onRemoveRecent: (path: string) => void
  onGoHome: () => void
}): React.JSX.Element {
  // ── 地址栏手感:点卡任意处 = 聚焦输入框 + 弹出菜单;⇅ 钮开/收;
  //    Esc / 点外 / 选中条目 = 收(useMenuDismiss 管外面,键盘管里面)
  const [menuOpen, setMenuOpen] = useState(false)
  // 键盘高亮行号:-1 = 还没动过方向键,Enter 还按「输入的路径」走;按下箭头才开始挑条目
  const [menuHi, setMenuHi] = useState(-1)
  const sections = menuWorkspaceRows(recents)
  const flatRows = [...sections.pinned, ...sections.history]
  useMenuDismiss(menuOpen, () => setMenuOpen(false), '.sidebar-top')

  // 键盘高亮的行滚进视野(菜单超 5 条内部滚动,高亮行可能躲在视口外)
  useEffect(() => {
    if (!menuOpen || menuHi < 0) return
    document.querySelector('.ws-menu .wsm-row.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [menuOpen, menuHi])

  function openMenu(): void {
    setMenuHi(-1)
    setMenuOpen(true)
  }

  function enterMenuRow(i: number): void {
    const row = flatRows[i]
    if (!row) return
    setMenuOpen(false)
    setMenuHi(-1)
    onOpenWorkspace(row.p)
  }

  // 路径输入框里的菜单按键:↑↓ 移动高亮,Enter 进高亮条目(没高亮就照旧开路径)
  function onCardKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (menuOpen && e.key === 'ArrowDown') {
      e.preventDefault()
      if (flatRows.length > 0) setMenuHi((hi) => (hi + 1) % flatRows.length)
      return
    }
    if (menuOpen && e.key === 'ArrowUp') {
      e.preventDefault()
      if (flatRows.length > 0) setMenuHi((hi) => (hi <= 0 ? flatRows.length - 1 : hi - 1))
      return
    }
    if (e.key === 'Enter') {
      if (menuOpen && menuHi >= 0 && menuHi < flatRows.length) enterMenuRow(menuHi)
      else void goPath()
      return
    }
    if (e.key === 'Escape') setPathDraft(folder ?? '')
  }

  /** 路径输入框右键:复制/粘贴走和自由对话输入舱同一张菜单 */
  function onPathContextMenu(e: React.MouseEvent<HTMLInputElement>): void {
    // 右键菜单和左侧的工作区历史菜单不同台,收掉旧的再摆
    setMenuOpen(false)
    setMenuHi(-1)
    openTextEditMenu({
      event: e,
      value: pathDraft,
      setValue: (next) => {
        setPathDraft(next)
        dismissPathHint()
      }
    })
  }

  return (
    <div className="sidebar-top">
      <div
        className={`ws-card${pathShaking ? ' is-shaking' : ''}${menuOpen ? ' is-menu-open' : ''}`}
        onAnimationEnd={() => setPathShaking(false)}
        onClick={() => {
          pathInputRef.current?.focus()
          openMenu()
        }}
      >
        <input
          ref={pathInputRef}
          className="ws-path"
          type="text"
          value={pathDraft}
          placeholder={folder ? '文件夹路径,回车直接打开' : '这台电脑'}
          disabled={scanning}
          spellCheck={false}
          aria-label="文件夹路径"
          onChange={(e) => {
            setPathDraft(e.target.value)
            dismissPathHint()
          }}
          onKeyDown={onCardKeyDown}
          onDoubleClick={(e) => e.currentTarget.select()}
          onContextMenu={onPathContextMenu}
        />
        <button
          type="button"
          className="tb-btn ws-menu-btn"
          disabled={scanning}
          data-tip={menuOpen ? '收起工作区菜单' : '展开工作区菜单'}
          aria-label={menuOpen ? '收起工作区菜单' : '展开工作区菜单'}
          aria-expanded={menuOpen}
          onClick={(e) => {
            // 点卡 = 开菜单的地址栏手感,⇅ 是明确的开关 —— 阻止冒泡别让卡的开抢戏
            e.stopPropagation()
            if (menuOpen) setMenuOpen(false)
            else openMenu()
          }}
        >
          {/* 两条 chevron 分挂类名,悬停各自动画(lucide 线稿,TreeIcon 同款笔触) */}
          <svg
            className="wsm-chev"
            width="1rem"
            height="1rem"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path className="wsm-chev-t" d={menuOpen ? 'm7 1 5 5 5-5' : 'm7 5.5 5-5 5 5'} />
            <path className="wsm-chev-b" d={menuOpen ? 'm7 23 5-5 5 5' : 'm7 18.5 5 5 5-5'} />
          </svg>
        </button>
        {pathHint && !menuOpen && (
          <div className="path-hint" role="status" title={pathHint}>
            {pathHint}
          </div>
        )}
        {menuOpen && (
          <WorkspaceMenu
            pinned={sections.pinned}
            history={sections.history}
            highlight={menuHi}
            onOpen={(p) => {
              setMenuOpen(false)
              setMenuHi(-1)
              onOpenWorkspace(p)
            }}
            onTogglePin={onTogglePin}
            onRemove={onRemoveRecent}
            onHome={() => {
              setMenuOpen(false)
              setMenuHi(-1)
              onGoHome()
            }}
          />
        )}
      </div>
    </div>
  )
}
