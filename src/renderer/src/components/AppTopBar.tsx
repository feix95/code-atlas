// 顶栏:logo 回家 / 打开项目 / 后退前进 / 刷新 / 路径框 / 设置,一整排共享一套图标规格。
import type { NavLocation } from '../navHistory'
import { IconArrowLeft, IconArrowRight, IconFolder, IconRefresh, TreeIcon } from './Icons'

/** 顶栏图标旋钮:打开项目/后退/前进/刷新/设置 五颗共享一套规格,跟文件树等别处分组互不相关。
 *  描边数换算:图标是 24 栅格,18px 下想真看出 2px 粗,strokeWidth = 2×24/18 ≈ 2.7 */
const TOPBAR_ICON_SIZE = 18
const TOPBAR_ICON_STROKE = 2.7

export function AppTopBar({
  scanning,
  folder,
  nav,
  pathDraft,
  pathHint,
  pathShaking,
  pathInputRef,
  goHome,
  handlePick,
  goNav,
  handleRefresh,
  setPathDraft,
  dismissPathHint,
  goPath,
  setPathShaking,
  setSettingsSection,
  setShowSettings
}: {
  scanning: boolean
  folder: string | null
  nav: { stack: NavLocation[]; index: number }
  pathDraft: string
  pathHint: string | null
  pathShaking: boolean
  pathInputRef: React.RefObject<HTMLInputElement | null>
  goHome: () => void
  handlePick: () => Promise<void>
  goNav: (delta: number) => Promise<void>
  handleRefresh: () => Promise<void>
  setPathDraft: React.Dispatch<React.SetStateAction<string>>
  dismissPathHint: () => void
  goPath: () => Promise<void>
  setPathShaking: React.Dispatch<React.SetStateAction<boolean>>
  setSettingsSection: React.Dispatch<React.SetStateAction<'appearance' | 'ai' | 'advanced'>>
  setShowSettings: React.Dispatch<React.SetStateAction<boolean>>
}): React.JSX.Element {
  return (
    <header className="topbar">
      <button
        type="button"
        className="brand"
        onClick={goHome}
        disabled={!folder || scanning}
        title={folder ? '回到首页' : '已经在首页了'}
        aria-label="回到首页"
      >
        <span className="brand-mark" aria-hidden="true">
          ⌁
        </span>
        CodeAtlas
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void handlePick()}
        disabled={scanning}
      >
        <IconFolder size={TOPBAR_ICON_SIZE} strokeWidth={TOPBAR_ICON_STROKE} />
        {scanning ? '扫描中……' : '打开项目'}
      </button>
      {/* 后退/前进(第八十三锤,小葵点名跟刷新放一起):在线的两端自己变灰;三颗全走 mono 单色 */}
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => void goNav(-1)}
        disabled={scanning || nav.index <= 0}
        title="后退"
        aria-label="后退"
      >
        <IconArrowLeft size={TOPBAR_ICON_SIZE} strokeWidth={TOPBAR_ICON_STROKE} mono />
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => void goNav(1)}
        disabled={scanning || nav.index >= nav.stack.length - 1}
        title="前进"
        aria-label="前进"
      >
        <IconArrowRight size={TOPBAR_ICON_SIZE} strokeWidth={TOPBAR_ICON_STROKE} mono />
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => void handleRefresh()}
        disabled={scanning}
        title={scanning ? '扫描中……' : '刷新'}
        aria-label="刷新"
      >
        <IconRefresh size={TOPBAR_ICON_SIZE} strokeWidth={TOPBAR_ICON_STROKE} mono />
      </button>
      <div
        className={`path-box${pathShaking ? ' is-shaking' : ''}`}
        onAnimationEnd={() => setPathShaking(false)}
      >
        <input
          ref={pathInputRef}
          className="path-input mono"
          type="text"
          value={pathDraft}
          placeholder="文件夹路径,回车直接打开"
          disabled={scanning}
          spellCheck={false}
          aria-label="文件夹路径"
          onChange={(e) => {
            setPathDraft(e.target.value)
            dismissPathHint()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void goPath()
            if (e.key === 'Escape') setPathDraft(folder ?? '')
          }}
        />
        <button
          type="button"
          className="btn path-go"
          onClick={() => void goPath()}
          disabled={scanning}
        >
          {scanning ? '……' : '前往'}
        </button>
        {pathHint && (
          <div className="path-hint" role="status">
            {pathHint}
          </div>
        )}
      </div>
      <button
        type="button"
        className="icon-btn"
        onClick={() => {
          setSettingsSection('appearance')
          setShowSettings(true)
        }}
        aria-label="打开设置"
      >
        <TreeIcon name="gear" size={TOPBAR_ICON_SIZE} strokeWidth={TOPBAR_ICON_STROKE} mono />
      </button>
    </header>
  )
}
