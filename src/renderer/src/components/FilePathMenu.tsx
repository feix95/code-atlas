import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  closeFilePathMenu,
  currentFilePathMenu,
  subscribeFilePathMenu,
  type FilePathMenuRequest
} from './filePathMenuStore'
import { useMenuDismiss } from '../useMenuDismiss'

/**
 * 文件路径右键菜单(全 app 就这一张:文件树 / 聊天绿字链接 / 预览器头部 / 参考资料,共用):
 * 右键弹出的小菜单,统一规格——
 * 1. 复制完整路径(盘符开头那种)进剪贴板;
 * 2. 在文件资源管理器中显示(资源管理器弹出、文件选中高亮);
 * 3. 可选段:预览文件(文件树给)、备注系列(写/编辑备注,有备注再带清除)。
 * 带路两件只「带路」不「开门」:开不开文件、怎么开,交给用户看到真实文件后自己决定。
 *
 * 菜单是自绘的(暗色主题一个皮肤,不弹系统白菜单),全局单例:挂在 App 根部一次,
 * 各处的链接按钮只管喊 openFilePathMenu 报坐标,不用每处自己养一份菜单状态。
 */

/** 菜单的估尺寸:宽窄一条,高按行数算(一项一行约 34px);贴窗口边时按它往里收,别弹出窗外 */
const MENU_W = 200
const ROW_H = 34
const EDGE = 8
/** 「已复制」反馈在菜单上停一拍的时长:成功短停就关,报错多停一拍让人看清 */
const COPY_LINGER_MS = 900
const FAIL_LINGER_MS = 1600

function clampedPosition(x: number, y: number, rows: number): { left: number; top: number } {
  return {
    left: Math.max(EDGE, Math.min(x, window.innerWidth - MENU_W - EDGE)),
    top: Math.max(EDGE, Math.min(y, window.innerHeight - (rows * ROW_H + 10) - EDGE))
  }
}

export function FilePathMenu(): React.JSX.Element | null {
  const request = useSyncExternalStore(subscribeFilePathMenu, currentFilePathMenu)

  // 菜单开着时的三条退路:点菜单外面、滚动内容、按 Esc —— 都是「用户不要了」,收摊
  useMenuDismiss(request !== null, closeFilePathMenu, '.file-path-menu')

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
      timerRef.current = window.setTimeout(closeFilePathMenu, FAIL_LINGER_MS)
      return
    }
    // 显示成功不用菜单夸 —— 资源管理器窗口自己弹出来,就是最响亮的反馈
    closeFilePathMenu()
  }

  const note = request.note ?? null
  const rows =
    2 +
    (request.preview ? 1 : 0) +
    (note ? 1 : 0) +
    (note !== null && note.hasNote && note.onRemove ? 1 : 0)
  const pos = clampedPosition(request.x, request.y, rows)
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
              timerRef.current = window.setTimeout(closeFilePathMenu, FAIL_LINGER_MS)
              return
            }
            // 反馈停一拍再收摊,让用户亲眼看到「已复制」,不是菜单凭空消失
            timerRef.current = window.setTimeout(closeFilePathMenu, COPY_LINGER_MS)
          })
        }}
        title={request.relPath}
      >
        {copied === 'ok'
          ? '已复制 ✓'
          : copied === 'fail'
            ? '没复制成,这路径有问题'
            : '复制完整路径'}
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
      {request.preview && (
        <button
          type="button"
          role="menuitem"
          className="file-path-menu-item"
          onClick={() => {
            request.preview?.()
            closeFilePathMenu()
          }}
          title={request.relPath}
        >
          预览文件
        </button>
      )}
      {note && (
        <button
          type="button"
          role="menuitem"
          className="file-path-menu-item"
          onClick={() => {
            note.onEdit()
            closeFilePathMenu()
          }}
          title={request.relPath}
        >
          {note.hasNote ? '编辑备注' : '写备注'}
        </button>
      )}
      {note !== null && note.hasNote && note.onRemove && (
        <button
          type="button"
          role="menuitem"
          className="file-path-menu-item"
          onClick={() => {
            note.onRemove?.()
            closeFilePathMenu()
          }}
          title={request.relPath}
        >
          清除备注
        </button>
      )}
    </div>
  )
}
