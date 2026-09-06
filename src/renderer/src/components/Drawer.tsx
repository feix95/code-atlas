import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * 右侧抽屉:AI 设置和 Git 面板共用。
 * 打开时盖在主内容上面而不是插进内容流 —— 关掉之后,当前文件、当前 Tab、
 * 目录树展开状态全都原地不动。Escape 或点遮罩立即关;左缘收起把手是主入口:
 * 点了面板先向外弹一小下、再猛地缩出视野(橡皮筋手感),动画走完才真关。
 */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): React.JSX.Element {
  // 收起动画进行中:面板在放橡皮筋,这期间不再接收点击
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closedRef = useRef(false)

  /** 立即关(× / Escape / 点遮罩),不走动画 */
  const closeNow = useCallback((): void => {
    if (closedRef.current) return
    closedRef.current = true
    if (closeTimer.current) clearTimeout(closeTimer.current)
    onClose()
  }, [onClose])

  /** 主关闭入口:先放收起动画,走完再真关 */
  const collapse = useCallback((): void => {
    if (closedRef.current) return
    if (!closeTimer.current) closeTimer.current = setTimeout(closeNow, 340)
    setClosing(true)
  }, [closeNow])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeNow()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [closeNow])

  return createPortal(
    <div className={`drawer-layer${closing ? ' is-closing' : ''}`}>
      <div className="drawer-overlay" onClick={closeNow} aria-hidden="true" />
      <aside className={`drawer${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="drawer-handle" onClick={collapse} aria-label={`收起${title}面板`} title="收起面板">
          <span aria-hidden="true">‹</span>
        </button>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={closeNow} aria-label="关闭面板">
            ×
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>,
    document.body
  )
}
