import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * 右侧抽屉:AI 设置和 Git 面板共用。
 * 打开时盖在主内容上面而不是插进内容流 —— 关掉之后,当前文件、当前 Tab、
 * 目录树展开状态全都原地不动。Escape 或点遮罩关闭。
 */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="drawer-layer">
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭面板">
            ×
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>,
    document.body
  )
}
