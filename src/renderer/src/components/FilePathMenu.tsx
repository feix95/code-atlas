import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { closeFilePathMenu, currentFilePathMenu, subscribeFilePathMenu, type FilePathMenuRequest } from './filePathMenuStore'

/**
 * 文件路径右键菜单(绿字文件链接 / 预览器头部文件名共用):右键弹出的小菜单,两件事——
 * 1. 复制完整路径(盘符开头那种)进剪贴板;
 * 2. 在文件资源管理器中显示(资源管理器弹出、文件选中高亮)。
 * 两件都只「带路」不「开门」:开不开文件、怎么开,交给用户看到真实文件后自己决定。
 *
 * 菜单是自绘的(暗色主题一个皮肤,不弹系统白菜单),全局单例:挂在 App 根部一次,
 * 各处的链接按钮只管喊 openFilePathMenu 报坐标,不用每处自己养一份菜单状态。
 */

/** 菜单的估尺寸:两项窄窄一条;贴窗口边时按它往里收,别弹出窗外 */
const MENU_W = 200
const MENU_H = 72
const EDGE = 8

function clampedPosition(x: number, y: number): { left: number; top: number } {
  return {
    left: Math.max(EDGE, Math.min(x, window.innerWidth - MENU_W - EDGE)),
    top: Math.max(EDGE, Math.min(y, window.innerHeight - MENU_H - EDGE))
  }
}

export function FilePathMenu(): React.JSX.Element | null {
  const request = useSyncExternalStore(subscribeFilePathMenu, currentFilePathMenu)

  // 菜单开着时的三条退路:点菜单外面、滚动内容、按 Esc —— 都是「用户不要了」,收摊
  useEffect(() => {
    if (!request) return
    const onMouseDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Element) || !e.target.closest('.file-path-menu')) closeFilePathMenu()
    }
    const onWheel = (): void => closeFilePathMenu()
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeFilePathMenu()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('wheel', onWheel, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('wheel', onWheel, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [request])

  if (!request) return null
  // key 带上位置:换个链接右键,菜单重挂一遍,「已复制」的旧状态不残留
  return <FilePathMenuCard key={`${request.x}:${request.y}:${request.relPath}`} request={request} />
}

function FilePathMenuCard({ request }: { request: FilePathMenuRequest }): React.JSX.Element {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [revealFail, setRevealFail] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    []
  )

  function noteThenClose(text: string | null): void {
    if (text !== null) {
      setRevealFail(text)
      timerRef.current = window.setTimeout(closeFilePathMenu, 1600)
      return
    }
    // 显示成功不用菜单夸 —— 资源管理器窗口自己弹出来,就是最响亮的反馈
    closeFilePathMenu()
  }

  const pos = clampedPosition(request.x, request.y)
  return (
    <div className="file-path-menu" style={{ left: pos.left, top: pos.top }} role="menu">
      <button
        type="button"
        role="menuitem"
        className={`file-path-menu-item${copied === 'ok' ? ' is-ok' : ''}${copied === 'fail' ? ' is-fail' : ''}`}
        onClick={() => {
          if (copied !== 'idle') return
          void request.copy().then((abs) => {
            setCopied(abs === null ? 'fail' : 'ok')
            if (abs === null) {
              timerRef.current = window.setTimeout(closeFilePathMenu, 1600)
              return
            }
            // 反馈停一拍再收摊,让用户亲眼看到「已复制」,不是菜单凭空消失
            timerRef.current = window.setTimeout(closeFilePathMenu, 900)
          })
        }}
        title={request.relPath}
      >
        {copied === 'ok' ? '已复制 ✓' : copied === 'fail' ? '没复制成,这路径有问题' : '复制完整路径'}
      </button>
      <button
        type="button"
        role="menuitem"
        className={`file-path-menu-item${revealFail !== null ? ' is-fail' : ''}`}
        onClick={() => {
          if (revealFail !== null) return
          void request.reveal().then(noteThenClose)
        }}
        title={request.relPath}
      >
        {revealFail ?? '在文件资源管理器中显示'}
      </button>
    </div>
  )
}
