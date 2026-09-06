import { useState } from 'react'
import type { GitChangesResult } from '@shared/types'
import { GitChanges } from './GitChanges'

/** VS Code 源代码管理同款的分支图标:左轨两颗圆点 + 一条岔出去的支线,描边风格走 currentColor */
function BranchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <circle cx="4.2" cy="3.4" r="1.9" />
        <circle cx="4.2" cy="12.6" r="1.9" />
        <circle cx="11.8" cy="9.4" r="1.9" />
        <path d="M4.2 5.3v5.4" />
        <path d="M6.1 3.4h2.3c1.7 0 3 1.3 3 3v1.1" />
      </g>
    </svg>
  )
}

/**
 * git 门(第六十五锤):侧边栏抽屉退役后,git 的家搬进右栏。
 * 门行收着 —— 分支图标挂数量徽章(沿用 VS Code 的蓝底白字圆标),点一下原地展开
 * 账本和 AI 干活报告,再点收回去;不再另开盖层。有未提交改动才亮,账结清自动退场。
 */
export function GitDoor({
  gitInfo,
  rootPath,
  onJump,
  onRefreshed
}: {
  gitInfo: GitChangesResult
  rootPath: string
  onJump: (relPath: string) => void
  onRefreshed?: (result: GitChangesResult) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!gitInfo.isGitRepo || gitInfo.stats.changed === 0) return null

  return (
    <div className="git-door-box">
      <button type="button" className="git-door" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="git-door-icon" aria-hidden="true">
          <BranchIcon />
          <span className="git-door-badge">{gitInfo.stats.changed}</span>
        </span>
        <span className="git-door-branch">{gitInfo.branch}</span>
        <span className="git-door-text">个项目还没提交 —— 点开就能看 AI 干活报告</span>
        <span className={`git-door-caret${open ? ' is-open' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="git-door-panel">
          <GitChanges rootPath={rootPath} onJump={onJump} initial={gitInfo} onRefreshed={onRefreshed} />
        </div>
      )}
    </div>
  )
}
