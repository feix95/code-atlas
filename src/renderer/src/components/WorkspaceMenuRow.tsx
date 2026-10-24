// 工作区菜单的一行:超长路径中间省略,盘符与末段同时可见;完整路径走行上悬停提示。
import { useLayoutEffect, useRef } from 'react'
import { ellipsisMiddlePath } from '../pathEllipsis'
import type { RecentProject } from '../recents'
import { TreeIcon } from './Icons'

interface WorkspaceRowProps {
  project: RecentProject
  isActive: boolean
  onOpen: (path: string) => void
  onTogglePin: (path: string) => void
  onRemove: (path: string) => void
}

export function WorkspaceRow({
  project,
  isActive,
  onOpen,
  onTogglePin,
  onRemove
}: WorkspaceRowProps): React.JSX.Element {
  const clipRef = useRef<HTMLSpanElement | null>(null)
  const pathRef = useRef<HTMLSpanElement | null>(null)
  const isPinned = project.pin !== undefined

  useLayoutEffect(() => {
    const clip = clipRef.current
    const pathEl = pathRef.current
    if (!clip || !pathEl) return
    const ctx = document.createElement('canvas').getContext('2d')
    const fit = (): void => {
      if (!ctx) {
        pathEl.textContent = project.p
        return
      }
      const cs = getComputedStyle(pathEl)
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      pathEl.textContent = ellipsisMiddlePath(
        project.p,
        clip.getBoundingClientRect().width,
        (text) => ctx.measureText(text).width
      )
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(clip)
    return () => observer.disconnect()
  }, [project.p, isPinned])

  return (
    <div
      className={`wsm-row${isActive ? ' is-active' : ''}${isPinned ? ' is-pinned' : ''}`}
      role="option"
      aria-selected={isActive}
    >
      <button
        type="button"
        className="wsm-pin"
        aria-label={isPinned ? `取消固定 ${project.p}` : `固定 ${project.p} 到列表顶部`}
        data-tip={isPinned ? '取消固定' : '固定到列表顶部'}
        data-tip-side="right"
        onClick={() => onTogglePin(project.p)}
      >
        <span className="wsm-pin-on" aria-hidden="true">
          <TreeIcon name="pinTack" size={13} mono />
        </span>
        <span className="wsm-pin-off" aria-hidden="true">
          <TreeIcon name="pinOff" size={13} mono />
        </span>
      </button>
      <button
        type="button"
        className="wsm-open"
        onClick={() => onOpen(project.p)}
        aria-label={project.p}
        data-tip={project.p}
        data-tip-side="right"
      >
        <span className="wsm-clip" ref={clipRef}>
          <span className="wsm-path" ref={pathRef} />
        </span>
      </button>
      <button
        type="button"
        className="wsm-del"
        aria-label={`从列表删掉 ${project.p}`}
        onClick={() => onRemove(project.p)}
      >
        ×
      </button>
    </div>
  )
}
