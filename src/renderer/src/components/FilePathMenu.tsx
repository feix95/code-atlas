import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { NOTE_MAX_CHARS } from '@shared/notes'
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
 * 3. 可选段:预览文件(文件树给)、备注系列(写/编辑备注就地长输入框,有备注再带清除)。
 * 带路两件只「带路」不「开门」:开不开文件、怎么开,交给用户看到真实文件后自己决定。
 *
 * 菜单是自绘的(暗色主题一个皮肤,不弹系统白菜单),全局单例:挂在 App 根部一次,
 * 各处的链接按钮只管喊 openFilePathMenu 报坐标,不用每处自己养一份菜单状态。
 */

/** 菜单的估尺寸:宽窄一条,高按行数算(一项一行约 34px);贴窗口边时按它往里收,别弹出窗外 */
const MENU_W = 200
const ROW_H = 34
/** 编辑行比普通行高:输入框自带内边距、边框和基线 */
const EDITOR_ROW_H = 46
const EDGE = 8
/** 「已复制」反馈在菜单上停一拍的时长:成功短停就关,报错多停一拍让人看清 */
const COPY_LINGER_MS = 900
const FAIL_LINGER_MS = 1600

function clampedPosition(
  x: number,
  y: number,
  height: number,
  view: Window
): { left: number; top: number } {
  return {
    left: Math.max(EDGE, Math.min(x, view.innerWidth - MENU_W - EDGE)),
    top: Math.max(EDGE, Math.min(y, view.innerHeight - height - EDGE))
  }
}

/** realm 铁律:子窗里的节点不是主窗 Node 的实例,只按 nodeType 认,不用 instanceof */
function isDomNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'nodeType' in value
}

export function FilePathMenu(): React.JSX.Element | null {
  const request = useSyncExternalStore(subscribeFilePathMenu, currentFilePathMenu)
  // realm 铁律:主窗和每个子窗各挂一台本组件 —— 挂载后从锚点元素认领自家 document,
  // 只画「在本 document 里被右键叫出来」的那张菜单
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const [doc, setDoc] = useState<Document | null>(null)
  useLayoutEffect(() => {
    setDoc(anchorRef.current?.ownerDocument ?? document)
  }, [])
  const mine = request !== null && doc !== null && request.doc === doc

  // 菜单开着时的三条退路:点菜单外面、滚动内容、按 Esc —— 都是「用户不要了」,收摊
  useMenuDismiss(mine, closeFilePathMenu, '.file-path-menu', doc ?? undefined)

  return (
    <>
      <span ref={anchorRef} hidden aria-hidden="true" />
      {mine && doc !== null && (
        // key 带上位置:换个链接右键,菜单重挂一遍,「已复制」的旧状态不残留
        <FilePathMenuCard
          key={`${request.x}:${request.y}:${request.relPath}`}
          request={request}
          doc={doc}
        />
      )}
    </>
  )
}

function FilePathMenuCard({
  request,
  doc
}: {
  request: FilePathMenuRequest
  doc: Document
}): React.JSX.Element {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [revealFail, setRevealFail] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const timerRef = useRef<number | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  // 编辑只结一次账:回车、失焦、点外面可能连着来,先到先算
  const settledRef = useRef(false)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    []
  )

  const note = request.note ?? null

  /**
   * 编辑结账:空稿视为取消(原备注留着),正文没变就不写盘。
   * 删备注只走「清除备注」那一行,避免「清空内容再点外面」把备注静默删掉。
   */
  const commitDraft = useCallback((): void => {
    if (settledRef.current || note === null) return
    settledRef.current = true
    const text = draft.trim()
    if (text !== '' && text !== note.text) note.onSave(text)
    closeFilePathMenu()
  }, [draft, note])

  // 编辑态的两条边界:Esc 只取消(菜单自己会关,这里先记账别让失焦误存)、点菜单外先结账再收摊。
  // 都挂在 window 捕获期:必须比 useMenuDismiss 的 document 捕获期更早,否则菜单先卸载就来不及了
  useEffect(() => {
    if (!editing) return
    const view = doc.defaultView
    if (!view) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') settledRef.current = true
    }
    const onMouseDown = (e: MouseEvent): void => {
      if (isDomNode(e.target) && cardRef.current?.contains(e.target)) return
      commitDraft()
    }
    view.addEventListener('keydown', onKeyDown, true)
    view.addEventListener('mousedown', onMouseDown, true)
    return () => {
      view.removeEventListener('keydown', onKeyDown, true)
      view.removeEventListener('mousedown', onMouseDown, true)
    }
  }, [editing, doc, commitDraft])

  function noteThenClose(text: string | null): void {
    if (text !== null) {
      setRevealFail(text)
      timerRef.current = window.setTimeout(closeFilePathMenu, FAIL_LINGER_MS)
      return
    }
    // 显示成功不用菜单夸 —— 资源管理器窗口自己弹出来,就是最响亮的反馈
    closeFilePathMenu()
  }

  const rows =
    2 +
    (request.preview ? 1 : 0) +
    (note ? 1 : 0) +
    (note !== null && note.hasNote && note.onRemove ? 1 : 0)
  const height = rows * ROW_H + 10 + (editing ? EDITOR_ROW_H - ROW_H : 0)
  const pos = clampedPosition(request.x, request.y, height, doc.defaultView ?? window)

  return (
    <div
      ref={cardRef}
      className="file-path-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
    >
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
        data-tip={request.relPath}
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
        data-tip={request.relPath}
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
          data-tip={request.relPath}
        >
          预览文件
        </button>
      )}
      {note &&
        (editing ? (
          <div className="file-path-menu-editor" role="none">
            <input
              autoFocus
              type="text"
              className="file-path-menu-input"
              value={draft}
              maxLength={NOTE_MAX_CHARS}
              placeholder="一句话备注:当初为什么建它/它是干嘛的"
              aria-label="备注内容"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                // 中文输入法选字时的回车是「上屏」,不是「保存」
                if (e.nativeEvent.isComposing) return
                e.preventDefault()
                commitDraft()
              }}
              onBlur={(e) => {
                // 焦点还在菜单里(点别的行)就先别结账,让那一行自己的点击生效
                if (isDomNode(e.relatedTarget) && cardRef.current?.contains(e.relatedTarget)) {
                  return
                }
                commitDraft()
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            role="menuitem"
            className="file-path-menu-item"
            onClick={() => {
              settledRef.current = false
              setDraft(note.text)
              setEditing(true)
            }}
            data-tip={request.relPath}
          >
            {note.hasNote ? '编辑备注' : '写备注'}
          </button>
        ))}
      {note !== null && note.hasNote && note.onRemove && (
        <button
          type="button"
          role="menuitem"
          className="file-path-menu-item"
          onClick={() => {
            note.onRemove?.()
            closeFilePathMenu()
          }}
          data-tip={request.relPath}
        >
          清除备注
        </button>
      )}
    </div>
  )
}
