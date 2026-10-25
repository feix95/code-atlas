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
import { OVERLAY_EDGE_FALLBACK_PX, clampOverlayBox, readTokenPx } from '../overlayLayout'

/**
 * 文件路径右键菜单(全 app 就这一张:文件树 / 这台电脑浏览树 / 聊天绿字链接,共用):
 * 右键弹出的小菜单,统一规格(按点击频率排)——
 * 1. 打开为工作区(文件夹专属的换根,走地址栏同一条扫描路;文件不摆);
 * 2. 打开所在位置(资源管理器弹出、文件选中高亮);
 * 3. 复制完整路径(盘符开头那种)进剪贴板;
 * 4. 可选段:预览文件(文件)、备注系列(写/编辑备注就地长输入框,有备注再带清除;这台电脑不摆,还没开项目)。
 * 「打开所在位置」和「复制完整路径」只「带路」不「开门」。
 *
 * 菜单是自绘的(暗色主题一个皮肤,不弹系统白菜单),全局单例:挂在 App 根部一次,
 * 各处的链接按钮只管喊 openFilePathMenu 报坐标,不用每处自己养一份菜单状态。
 */

/** 「已复制」反馈在菜单上停一拍的时长:成功短停就关,报错多停一拍让人看清 */
const COPY_LINGER_MS = 900
const FAIL_LINGER_MS = 1600

function menuLabel(text: string): React.JSX.Element {
  return (
    <span className="fpm-label" title={text}>
      {text}
    </span>
  )
}

/** 渲染域隔离:子窗里的节点不是主窗 Node 的实例,只按 nodeType 认,不用 instanceof */
function isDomNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'nodeType' in value
}

export function FilePathMenu(): React.JSX.Element | null {
  const request = useSyncExternalStore(subscribeFilePathMenu, currentFilePathMenu)
  // 渲染域隔离:主窗和每个子窗各挂一台本组件 —— 挂载后从锚点元素认领自家 document,
  // 只画「在本 document 里被右键叫出来」的那张菜单
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const [doc, setDoc] = useState<Document | null>(null)
  useLayoutEffect(() => {
    setDoc(anchorRef.current?.ownerDocument ?? document)
  }, [])
  const mine = request !== null && doc !== null && request.doc === doc

  // 菜单开着时的三条退路:点菜单外面、滚动内容、按 Esc —— 都是「用户不要了」,关闭
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
  const [openFail, setOpenFail] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
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

  // 编辑态的两条边界:Esc 只取消(菜单自己会关,这里先记账别让失焦误存)、点菜单外先结账再关闭。
  // 都挂在 window 捕获期:必须比 useMenuDismiss 的 document 捕获期更早,否则菜单先卸载就来不及了。
  // pointerdown 与 mousedown 都听:看图舞台 preventDefault 后浏览器不发 mousedown。
  useEffect(() => {
    if (!editing) return
    const view = doc.defaultView
    if (!view) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') settledRef.current = true
    }
    const onOutsideDown = (e: Event): void => {
      if (isDomNode(e.target) && cardRef.current?.contains(e.target)) return
      commitDraft()
    }
    view.addEventListener('keydown', onKeyDown, true)
    view.addEventListener('pointerdown', onOutsideDown, true)
    view.addEventListener('mousedown', onOutsideDown, true)
    return () => {
      view.removeEventListener('keydown', onKeyDown, true)
      view.removeEventListener('pointerdown', onOutsideDown, true)
      view.removeEventListener('mousedown', onOutsideDown, true)
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

  // 宽高由 CSS 自适配,量完真实盒子再贴窗边夹紧,不再写死 MENU_W
  useLayoutEffect(() => {
    const el = cardRef.current
    const view = doc.defaultView
    if (!el || !view) return
    const box = el.getBoundingClientRect()
    const edge = readTokenPx(el, view, '--overlay-edge', OVERLAY_EDGE_FALLBACK_PX)
    const next = clampOverlayBox(request.x, request.y, box.width, box.height, view, edge)
    setPos((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next))
  }, [request.x, request.y, request.relPath, editing, copied, revealFail, openFail, doc, note])

  const openLabel = openFail ?? '打开为工作区'
  const revealLabel = revealFail ?? '打开所在位置'
  const copyLabel =
    copied === 'ok' ? '已复制 ✓' : copied === 'fail' ? '没复制成,这路径有问题' : '复制完整路径'
  const noteLabel = note?.hasNote ? '编辑备注' : '写备注'

  return (
    <div
      ref={cardRef}
      className="file-path-menu"
      style={{
        left: pos?.left ?? request.x,
        top: pos?.top ?? request.y,
        visibility: pos ? 'visible' : 'hidden'
      }}
      role="menu"
    >
      {request.openWorkspace && (
        <button
          type="button"
          role="menuitem"
          className={`file-path-menu-item${openFail !== null ? ' is-fail' : ''}`}
          onClick={() => {
            if (openFail !== null) return
            void request.openWorkspace?.().then((msg) => {
              if (msg) {
                setOpenFail(msg)
                timerRef.current = window.setTimeout(closeFilePathMenu, FAIL_LINGER_MS)
                return
              }
              closeFilePathMenu()
            })
          }}
          data-tip={request.relPath}
        >
          {menuLabel(openLabel)}
        </button>
      )}
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
        {menuLabel(revealLabel)}
      </button>
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
            // 反馈停一拍再关闭,让用户亲眼看到「已复制」,不是菜单凭空消失
            timerRef.current = window.setTimeout(closeFilePathMenu, COPY_LINGER_MS)
          })
        }}
        data-tip={request.relPath}
      >
        {menuLabel(copyLabel)}
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
          {menuLabel('预览文件')}
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
              placeholder="添加备注…"
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
            {menuLabel(noteLabel)}
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
          {menuLabel('清除备注')}
        </button>
      )}
    </div>
  )
}
