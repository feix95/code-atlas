import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatCodeRef, FilePreviewResult, ScanFileNode } from '@shared/types'
import { friendlyErr } from '../errText'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'
import { TreeIcon } from './Icons'
import { MiniMD } from './MiniMD'
import { openContextMenu } from './contextMenuStore'
import { SourceEditor } from './SourceEditor'
import type { FileLinkTarget } from '@shared/fileLinks'
import { canReadingMode, type PaneViewMode } from '../paneTabs'
import { loadCodeWrapOn, saveCodeWrapOn } from '../codePrefs'
import { getDocZoom, setDocZoom, useDocZoom } from '../docZoom'
import { DOC_ZOOM_STEP } from '@shared/docZoom'

/** 「一闪而过」小开关的亮灯时长:整条复制提示停久一点 */
const COPIED_ALL_MS = 2000
/** 头部折行/模式开关图标(19.2px = 1.2rem) */
const WRAP_ICON_SIZE = 19.2
/**
 * 折行模式的行数闸(老规矩留档):虚拟滚动时代折行要全量上 DOM 才有的闸,
 * 编辑器自己就是虚拟渲染,闸现在只当「巨型文件默认不折行」的保守口味。
 */
const WRAP_MAX_LINES = 5000
/** 滚轮一格的像素门槛 / 碎步账的保鲜期(Ctrl+滚轮文档缩放用,和界面缩放滚轮同脾气) */
const WHEEL_NOTCH = 100
const WHEEL_ACC_TTL_MS = 400

// realm 铁律:预览签被拖进子窗后,选区/事件都活在子窗 document 里 ——
// 一律经元素的 ownerDocument 这族取,别摸全局 window(那是主窗的,子窗里选不中、监不到)
function viewOf(el: HTMLElement | null): Window | null {
  return el?.ownerDocument.defaultView ?? null
}

/**
 * 代码预览/编辑(预览编辑锤·锤2):树上右键「预览文件」后,左栏装这扇文本窗。
 * 源码档 = CodeMirror 6 编辑器:所有文本文件打开就能改,停手 1 秒自动落盘;
 * 行号/撤销/选区/搜索键位全是编辑器自带的。分色仍吃主进程 tree-sitter 的段落账,
 * 存盘后重算换新;选区引用(右键菜单/直拖)照老规矩,角标美术随新引擎退役。
 * 阅读档(md 系)还是 MiniMD 渲染稿;切档时编辑器把最新文稿经 onTextChange 留在父层。
 * 不可预览的情况(二进制/超大/读不了)老实说明白,绝不硬塞一屏乱码。
 */
export function CodePreview({
  rootPath,
  file,
  canAddRef,
  refLimit,
  onAddRef,
  jump,
  viewMode,
  onSetViewMode,
  fileLinks
}: {
  rootPath: string
  file: ScanFileNode
  /** 引用额度还没用满(满了菜单就说清楚,不装作没反应) */
  canAddRef: boolean
  /** 一轮最多引几段(跟主进程同一个数) */
  refLimit: number
  onAddRef: (ref: ChatCodeRef) => void
  /** 跳到第几行(聊天里的文件链接点的):正文载入后滚过去,行号越界夹到文件边缘;seq 变了再跳一次 */
  jump?: { line: number; seq: number } | null
  /** 看片档位:undefined/'source' = 源码编辑;'reading' = md 渲染态(只对 md 系生效) */
  viewMode?: PaneViewMode
  /** 头部「阅读/代码」快速开关:切本签的看片档(账在页签身上,和右键菜单同一份) */
  onSetViewMode?: (mode: PaneViewMode) => void
  /** 阅读模式里的文件链接通道:工作区签传它,md 里对得上户口的文件名渲染成可点链接 */
  fileLinks?: FileLinkTarget | null
}): React.JSX.Element {
  const codeViewRef = useRef<HTMLDivElement>(null)
  // ── 换文件就地复位(隐身案这锤):App 不再挂 key={relPath} 强制重挂,复位收编进组件 ——
  //    所有现场按文件名记账,哪份文件的账归哪份用;对不上号,当场回出厂,绝不串台 ──
  /** 读文件这笔账:读到什么/出什么错,记在哪个文件名下 */
  const [loadedAt, setLoadedAt] = useState<{
    file: string
    result: FilePreviewResult | null
    err: string | null
  }>({
    file: '',
    result: null,
    err: null
  })
  const result = loadedAt.file === file.relPath ? loadedAt.result : null
  const err = loadedAt.file === file.relPath ? loadedAt.err : null
  /** 「已复制」一闪而过小开关的账 */
  const [uiAt, setUiAt] = useState<{
    file: string
    copiedAll: boolean
  }>({
    file: '',
    copiedAll: false
  })
  const copiedAll = uiAt.file === file.relPath && uiAt.copiedAll
  /** 改小开关:只动当前文件的账;换了文件才姗姗来迟的开关(迟到定时器),当没看见 */
  const patchUi = useCallback(
    (patch: Partial<{ copiedAll: boolean }>): void => {
      setUiAt((prev) => (prev.file === file.relPath ? { ...prev, ...patch } : prev))
    },
    [file.relPath]
  )
  /**
   * 编辑中的最新文稿(state 账):编辑器一打字就更新,切阅读档时按它渲染 ——
   * 每键一渲的账很轻(顶栏两颗钮 + 一层框,编辑器自身不重立);
   * 按文件名记账,别份文件的稿子绝不冒名顶替。
   */
  const [editAt, setEditAt] = useState<{ file: string; text: string } | null>(null)
  const onTextChange = useCallback(
    (t: string): void => {
      setEditAt({ file: file.relPath, text: t })
    },
    [file.relPath]
  )
  /**
   * 折行开关(全局默认开这锤):一个开关管所有文件,存 localStorage 重启不失忆;
   * 超行数闸的文件摁不动(巨物默认不折行的保守口味)。
   */
  const [wrapOn, setWrapOn] = useState(loadCodeWrapOn)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 路径契约:renderer 只回传 (rootPath, relPath),绝对路径是主进程的事。
  // 账记在文件名下:新文件还没回话时,旧文件的内容一秒都不冒名顶替
  useEffect(() => {
    let alive = true
    window.atlas
      .readPreview(rootPath, file.relPath)
      .then((res) => {
        if (alive) setLoadedAt({ file: file.relPath, result: res, err: null })
      })
      .catch((e) => {
        if (alive) setLoadedAt({ file: file.relPath, result: null, err: friendlyErr(e) })
      })
    return () => {
      alive = false
    }
  }, [rootPath, file.relPath])

  const diskText = result?.status === 'ok' ? result.text : ''
  /** 分色账(预览分色这锤):主进程按行给好的段落;没有 = 这份不上色,白字照常 */
  const colors = result?.status === 'ok' ? result.colors : undefined
  /** 编辑器手里的最新文稿:没动过字 = 盘上那份,动过 = 编辑稿 */
  const text = editAt?.file === file.relPath ? editAt.text : diskText
  /** 行数闸用打开时的行数(编辑中跨线的概率低,巨物保守口味不跟着抖) */
  const total = useMemo(() => (diskText === '' ? 0 : diskText.split('\n').length), [diskText])
  const wrapAllowed = total > 0 && total <= WRAP_MAX_LINES
  const wrap = wrapAllowed && wrapOn
  // 阅读模式(这锤的新档):md 系签才生效 —— MiniMD 渲染态,编辑器是源码档的家务
  const reading = viewMode === 'reading' && canReadingMode(file.relPath)
  // 文档字号缩放(Ctrl+滚轮这锤):系数落 --doc-zoom,正文各行 font-size 乘它
  const docZoom = useDocZoom()

  // Ctrl+滚轮 = 文档字号缩放(docZoom,小葵定的分工:界面缩放只吃键盘 +/-/0)。
  // 监听器挂预览元素本身 —— 天然 realm-safe(子窗签的滚轮事件在子窗文档里转,沾不到全局 window);
  // 碎步积累成整档才翻、隔久清账,触控板捏合在 Chromium 里也报 ctrl+wheel,捏合白捡。
  // 编辑器里滚轮事件照冒泡上来(cm-scroller → code-view),缩放对编辑态一样灵。
  useEffect(() => {
    const view = codeViewRef.current
    if (!view) return
    let acc = 0
    let last = 0
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      const now = performance.now()
      if (now - last > WHEEL_ACC_TTL_MS) acc = 0
      last = now
      acc += dy
      const steps = Math.trunc(acc / WHEEL_NOTCH)
      if (steps === 0) return
      acc -= steps * WHEEL_NOTCH
      setDocZoom(getDocZoom() - steps * DOC_ZOOM_STEP) // 向下滚(deltaY>0)= 缩小
    }
    view.addEventListener('wheel', onWheel, { passive: false })
    return () => view.removeEventListener('wheel', onWheel)
  }, [result, reading])

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    },
    []
  )

  /** 折行开关一个口:页头钮、Alt+Z(编辑器内外都通)都走这里,偏好当场落盘 */
  const toggleWrap = useCallback((): void => {
    if (!wrapAllowed) return
    setWrapOn((prev) => {
      saveCodeWrapOn(!prev)
      return !prev
    })
  }, [wrapAllowed])

  function onPaneKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      return
    // Alt+Z 切自动换行(VS Code 同款键位):编辑器内有它自己的键位账,这里是栏外/阅读档的口
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      toggleWrap()
      return
    }
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return
    e.preventDefault()
    if (text === '') return
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        patchUi({ copiedAll: true })
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
        copiedTimerRef.current = setTimeout(() => patchUi({ copiedAll: false }), COPIED_ALL_MS)
      })
      .catch(() => {})
  }

  /** 阅读模式的右键:渲染态里没有行号账,选中了就给「复制选中段」一口 */
  function onReadContextMenu(e: React.MouseEvent<HTMLDivElement>): void {
    const el = codeViewRef.current
    const s = viewOf(el)?.getSelection()
    if (!el || !s || s.isCollapsed || s.rangeCount === 0 || !el.contains(s.anchorNode)) return
    const picked = s.toString()
    if (picked.trim() === '') return
    e.preventDefault()
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      doc: el.ownerDocument,
      items: [
        {
          label: '复制选中段',
          icon: 'copy',
          run: () =>
            navigator.clipboard
              .writeText(picked)
              .then(() => '已复制 ✓')
              .catch(() => '没复制成,剪贴板被顶住了')
        }
      ]
    })
  }

  /**
   * 阅读/代码快速开关(和页签右键菜单同一份 viewMode 账):图标换脸标态 ——
   * bookOpen = 正读渲染稿,code = 正在编辑;非 md 文件常驻置灰(菜单同款口径)。
   */
  const canRead = canReadingMode(file.relPath)
  const modeBtn: React.JSX.Element = (
    <button
      type="button"
      className="code-mode-btn"
      disabled={!canRead}
      aria-pressed={reading}
      aria-label={reading ? '切到代码模式' : '切到阅读模式'}
      data-tip={!canRead ? 'Markdown 文件专属' : reading ? '当前:阅读模式' : '当前:编辑模式'}
      onClick={() => onSetViewMode?.(reading ? 'source' : 'reading')}
    >
      <TreeIcon name={reading ? 'bookOpen' : 'code'} size={WRAP_ICON_SIZE} />
    </button>
  )

  return (
    <div className="code-pane soft-in" onKeyDown={onPaneKeyDown}>
      {/* 页头栏:两档共用一排功能钮(模式开关 + 换行钮),右对齐;文件名不摆 ——
          签条上已有名字。阅读档的内联标题是文档正文的title,跟页头 chrome 不冲突 */}
      {result?.status === 'ok' && (
        <div className="code-pane-head">
          {onSetViewMode && modeBtn}
          <button
            type="button"
            className={`code-wrap-btn${wrap ? ' is-on' : ''}`}
            disabled={!wrapAllowed}
            aria-pressed={wrap}
            aria-label="自动换行(Alt+Z)"
            data-tip={
              !wrapAllowed
                ? `这份文件超过 ${WRAP_MAX_LINES} 行,折行先歇着`
                : wrap
                  ? '当前:自动换行'
                  : '当前:不换行'
            }
            onClick={toggleWrap}
          >
            {/* 状态走图标换脸(小葵拍板,不靠底色):折回箭头 = 开着,参差行尾 = 关着 */}
            <TreeIcon name={wrap ? 'wrapText' : 'textAlignStart'} size={WRAP_ICON_SIZE} />
          </button>
        </div>
      )}
      {err && <Notice kind="error">{err}</Notice>}
      {!err && !result && (
        <div className="card-waiting">
          <ProgressDots />
          正在读文件……
        </div>
      )}
      {!err && result && result.status !== 'ok' && (
        <p className="code-pane-note">{result.reason}</p>
      )}
      {!err && result?.status === 'ok' && (
        <>
          {copiedAll && <p className="code-pane-note">全文已复制到剪贴板</p>}
          {reading ? (
            /* 阅读档:md 系签的渲染态 —— MiniMD 排版进可读栏,吃编辑器留下的最新文稿 */
            <div
              className="code-view is-reading"
              ref={codeViewRef}
              tabIndex={0}
              style={{ '--doc-zoom': docZoom } as React.CSSProperties}
              aria-label={`${file.relPath} 的阅读模式,全文可滚;按 Ctrl+A 复制全文`}
              onContextMenu={onReadContextMenu}
            >
              <article className="code-reading">
                {/* 内联标题(Obsidian 同款):文件名掐尾去扩展名,摆正文顶上居中 */}
                <MiniMD
                  text={text}
                  fileLinks={fileLinks ?? undefined}
                  title={file.relPath
                    .split(/[\\/]/)
                    .pop()
                    ?.replace(/\.[^.]+$/, '')}
                />
              </article>
            </div>
          ) : (
            /* 源码档:CodeMirror 编辑器 —— 自动保存、分色、选区引用全在它屋里 */
            <div
              className="code-view is-editing"
              ref={codeViewRef}
              style={{ '--doc-zoom': docZoom } as React.CSSProperties}
            >
              <SourceEditor
                key={file.relPath}
                rootPath={rootPath}
                relPath={file.relPath}
                initialText={text}
                /* 文稿和盘上对得上才给初始色:对不上是带着未存改动,旧色错位不如不给 */
                initialColors={text === diskText ? colors : undefined}
                wrap={wrap}
                canAddRef={canAddRef}
                refLimit={refLimit}
                onAddRef={onAddRef}
                onTextChange={onTextChange}
                onToggleWrap={toggleWrap}
                jump={jump}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
