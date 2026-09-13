import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatCodeRef, FilePreviewResult, ScanFileNode } from '@shared/types'
import { CODE_REF_CHARS_MAX } from '@shared/aiDefaults'
import { planWholeFileRef, visibleLineRange } from '@shared/preview'
import { friendlyErr } from '../errText'
import { clampButtonX, refButtonLabel, selectionGeometry, type SelectionGeometry } from '../selectionMarks'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'
import { TreeIcon } from './Icons'
import { openFilePathMenuFor, type FilePathNoteActions } from './filePathMenuStore'

/** 选中的一段 + 它四样东西的落点(第一百一十四锤) */
interface Selection extends SelectionGeometry {
  startLine: number
  endLine: number
  code: string
}

/** 数一段文本里有几个换行 —— 行号就是这么算出来的 */
function countNewlines(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++
  }
  return n
}

/**
 * 代码预览(第一百一十锤):树上右键「预览文件」后,左栏从目录树换成这扇只读的文本窗。
 * 只摆纯文本 + 行号 —— 不描语法色(那是另一锤的事),看得清、选得中就行。
 * 正文只活在这个组件的 state 里:退出预览组件一卸,内容跟着就走,不留垃圾。
 * 不可预览的情况(二进制/超大/读不了)老实说明白,绝不硬塞一屏乱码。
 * 第一百一十一锤:选中一段代码,选区上方冒出「引用到对话」,点了挂到右栏的输入框上。
 * 第一百一十四锤:选区美术 —— 选中色跟辅助色走,首尾各一枚角括号,左缘一条竖线;
 * 顶栏给一颗钮,把整份代码挂到右栏对话(第一百一十四锤补2)。
 * 全文预览(2026-09-13):虚拟滚动 —— 全文在手,轨道撑出全文行程,画面只画可视区一截;
 * 行数/字数两道闸退役,Ctrl+A 改成复制全文。
 */
export function CodePreview({
  rootPath,
  file,
  canAddRef,
  refLimit,
  onAddRef,
  onClose,
  jump,
  noteMenu
}: {
  rootPath: string
  file: ScanFileNode
  /** 引用额度还没用满(满了浮钮就说清楚,不装作没反应) */
  canAddRef: boolean
  /** 一轮最多引几段(跟主进程同一个数) */
  refLimit: number
  onAddRef: (ref: ChatCodeRef) => void
  onClose: () => void
  /** 跳到第几行(聊天里的文件链接点的):正文载入后滚过去,行号越界夹到文件边缘;seq 变了再跳一次 */
  jump?: { line: number; seq: number } | null
  /** 备注三件套(菜单统一大锤):头部文件名右键菜单带上写/清备注,跟树里、聊天里一个规格 */
  noteMenu?: FilePathNoteActions
}): React.JSX.Element {
  const codeTextRef = useRef<HTMLPreElement>(null)
  const codeViewRef = useRef<HTMLDivElement>(null)
  // ── 换文件就地复位(隐身案这锤):App 不再挂 key={relPath} 强制重挂,复位收编进组件 ——
  //    所有现场按文件名记账,哪份文件的账归哪份用;对不上号,当场回出厂,绝不串台 ──
  /** 读文件这笔账:读到什么/出什么错,记在哪个文件名下 */
  const [loadedAt, setLoadedAt] = useState<{ file: string; result: FilePreviewResult | null; err: string | null }>({
    file: '',
    result: null,
    err: null
  })
  const result = loadedAt.file === file.relPath ? loadedAt.result : null
  const err = loadedAt.file === file.relPath ? loadedAt.err : null
  /** 选区记号:选了哪段,记在哪个文件上 */
  const [selAt, setSelAt] = useState<{ file: string; sel: Selection | null }>({ file: '', sel: null })
  const sel = selAt.file === file.relPath ? selAt.sel : null
  /** 三个一闪而过的小开关(浮钮/已引用/已复制)共用一本账 */
  const [uiAt, setUiAt] = useState<{ file: string; showButton: boolean; added: boolean; copiedAll: boolean }>({
    file: '',
    showButton: false,
    added: false,
    copiedAll: false
  })
  // 浮钮露不露脸(第一百一十四锤补):拖动中不露,手松开/键盘选完才露
  const showButton = uiAt.file === file.relPath && uiAt.showButton
  const added = uiAt.file === file.relPath && uiAt.added
  const copiedAll = uiAt.file === file.relPath && uiAt.copiedAll
  /** 改小开关:只动当前文件的账;换了文件才姗姗来迟的开关(迟到定时器),当没看见 */
  const patchUi = useCallback(
    (patch: Partial<{ showButton: boolean; added: boolean; copiedAll: boolean }>): void => {
      setUiAt((prev) => (prev.file === file.relPath ? { ...prev, ...patch } : prev))
    },
    [file.relPath]
  )
  // ── 虚拟滚动(全文预览这锤):全文在手,画面只画可视区那一截 ──
  const [lineHeight, setLineHeight] = useState(20)
  /** 滚动位滚到哪儿,记在哪份文件名下:换文件自动回楼顶 */
  const [scrollAt, setScrollAt] = useState<{ file: string; top: number }>({ file: '', top: 0 })
  const scrollTop = scrollAt.file === file.relPath ? scrollAt.top : 0
  const [viewportHeight, setViewportHeight] = useState(0)
  const scrollRafRef = useRef(0)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 可视区第一行的行号:选区行号 = 这一行 + 选区里的换行数(划中的行号报真号)
  const chunkBaseRef = useRef(1)

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

  const text = result?.status === 'ok' ? result.text : ''

  // 全文在手:按行切一份备用(纯字符串,不占画面);画面永远只画 range 那一截
  const lines = useMemo(() => (text === '' ? [] : text.split('\n')), [text])
  const total = lines.length

  // 行高只量一次:等宽字体行行等高,量准一次,全文的滚动高度就是它乘出来的。
  // 界面缩放改了根字号,行高跟着变,重量一遍。
  useLayoutEffect(() => {
    const measure = (): void => {
      const pre = codeTextRef.current
      if (!pre) return
      const lh = Number.parseFloat(window.getComputedStyle(pre).lineHeight)
      if (Number.isFinite(lh) && lh > 0) setLineHeight(lh)
    }
    measure()
    window.addEventListener('atlas:ui-scale', measure)
    return () => window.removeEventListener('atlas:ui-scale', measure)
  }, [result])

  // 视口高度:可视行数靠它;窗口/分栏改尺寸跟着重算
  useEffect(() => {
    const view = codeViewRef.current
    if (!view) return
    const ro = new ResizeObserver(() => setViewportHeight(view.clientHeight))
    ro.observe(view)
    setViewportHeight(view.clientHeight)
    return () => ro.disconnect()
  }, [result])

  // 滚动只改一个数:rAF 攒帧,一帧最多重算一次可视区
  const onScroll = useCallback((): void => {
    if (scrollRafRef.current !== 0) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      setScrollAt({ file: file.relPath, top: codeViewRef.current?.scrollTop ?? 0 })
    })
  }, [file.relPath])
  useEffect(
    () => () => {
      if (scrollRafRef.current !== 0) cancelAnimationFrame(scrollRafRef.current)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    },
    []
  )

  // 聊天文件链接点的跳行:正文载入后滚到目标行。行号是模型报的,只能信个大概 ——
  // 超出文件就夹到最后一行,负数夹回第一行,最坏结果是停在文件尾,绝不是红字报错。
  // 目标行落在视口上三分之一,让眼睛先看到它上面的东西(它在讲哪段代码,有上下文)。
  // 下一帧再动身:换文件头一帧新轨道还没立稳,当场写滚动位会被旧高度夹住、落点差一截;
  // 等浏览器把新文件的布局铺好再滚,一步到位(外援建议,这锤采纳)
  useEffect(() => {
    if (!jump || result?.status !== 'ok' || total === 0) return
    const raf = requestAnimationFrame(() => {
      const el = codeViewRef.current
      if (!el) return
      const target = Math.min(Math.max(jump.line, 1), total)
      el.scrollTop = Math.max(0, (target - 1) * lineHeight - el.clientHeight / 3)
    })
    return () => cancelAnimationFrame(raf)
  }, [jump, result, total, lineHeight])

  // 该画哪几行(纯函数) + 这一段的正文和行号格子;轨道总高 = 总行数 × 行高,滚动条行程是全文的
  const range = visibleLineRange({ scrollTop, viewportHeight, lineHeight, totalLines: total })
  // 可视区第一行的行号给选区计算当基准(effect 落定,不在渲染途中改 ref)
  useEffect(() => {
    chunkBaseRef.current = range.start
  }, [range.start])
  const offsetY = (range.start - 1) * lineHeight
  const chunk = useMemo(
    () => (total === 0 ? '' : lines.slice(range.start - 1, range.end).join('\n')),
    [lines, total, range.start, range.end]
  )
  const gutter = useMemo(() => {
    if (total === 0 || range.start > range.end) return ''
    const nums: string[] = []
    for (let n = range.start; n <= range.end; n++) nums.push(String(n))
    return nums.join('\n')
  }, [total, range.start, range.end])

  /** 从当前选区算一遍完整信息;没选东西、或选的是别处的字,回 null */
  const computeSelection = useCallback((): Selection | null => {
    const el = codeTextRef.current
    const s = window.getSelection()
    if (!el || !s || s.isCollapsed || s.rangeCount === 0 || !el.contains(s.anchorNode)) return null
    const code = s.toString()
    if (code.trim() === '') return null
    const rects = Array.from(s.getRangeAt(0).getClientRects())
    const geom = selectionGeometry(rects)
    if (!geom) return null
    const view = codeViewRef.current?.getBoundingClientRect()
    const full = el.textContent ?? ''
    const start = Math.min(s.anchorOffset, s.focusOffset)
    const end = Math.max(s.anchorOffset, s.focusOffset)
    return {
      ...geom,
      // 以选区右上角为锚、居中浮着;夹紧留出钮的一半身位,贴着栏边选的也不越出栏外
      buttonX: view ? clampButtonX(geom.buttonX, view.left, view.right, 100) : geom.buttonX,
      startLine: chunkBaseRef.current + countNewlines(full.slice(0, start)),
      // 收尾用 end-1:选区末尾正好压在下一行的行首时,别把没选的那一行算进来
      endLine: chunkBaseRef.current + countNewlines(full.slice(0, Math.max(start, end - 1))),
      code
    }
  }, [])

  /**
   * 记号跟着选区走(拖到哪儿标到哪儿),返回算好的这一份。
   * 浮钮的露脸状态不归它管,那是调用方的事:拖动中一律不露,
   * 手松开(pointerup)或键盘选完(keyup)才请出来。
   * 第一百一十四锤补:从前一按下就露,按钮跟着鼠标跑,你会从它身上拖过去,
   * 它的标签还会被一起吞进选区 —— 看着就像选区坏了。
   */
  const followSelection = useCallback((): Selection | null => {
    const next = computeSelection()
    setSelAt({ file: file.relPath, sel: next })
    return next
  }, [computeSelection, file.relPath])

  // 选区一变就重画记号;选区没了,浮钮也跟着收
  useEffect(() => {
    if (result?.status !== 'ok') return
    const onSelectionChange = (): void => {
      if (followSelection() === null) patchUi({ showButton: false })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [result, followSelection, patchUi])

  // 滚动/改窗口大小会让视口坐标失效:重算落点,只在整个选区滚出视野时才收起来。
  // (只挪记号,不动浮钮的露脸状态 —— 滚一下不该把它收了。)
  useEffect(() => {
    const view = codeViewRef.current
    let frame = 0
    const reposition = (): void => {
      frame = 0
      if (followSelection() === null) patchUi({ showButton: false })
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(reposition)
    }
    window.addEventListener('resize', schedule)
    view?.addEventListener('scroll', schedule, { passive: true })
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      view?.removeEventListener('scroll', schedule)
    }
  }, [result, followSelection, patchUi])

  // 选完才算数:鼠标松开、或键盘选完(shift+方向键抬手),这时才把浮钮请出来。
  // 捕获阶段听:鼠标在哪儿松开都收得到(拖到隔壁聊天区放手,也算选完了)。
  useEffect(() => {
    if (result?.status !== 'ok') return
    const onPointerDown = (e: PointerEvent): void => {
      // 点在浮钮自己身上不算「开始新选区」—— 否则它会在 click 之前先消失,点了没反应
      const target = e.target as HTMLElement | null
      if (target?.closest?.('.code-select-btn')) return
      patchUi({ showButton: false })
    }
    const onDone = (): void => {
      if (followSelection() !== null) patchUi({ showButton: true })
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onDone, true)
    window.addEventListener('keyup', onDone, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onDone, true)
      window.removeEventListener('keyup', onDone, true)
    }
  }, [result, followSelection, patchUi])

  /**
   * Ctrl+A 复制全文(全文预览这锤):虚拟滚动后元素里只有一屏,浏览器的「全选」最多
   * 选到眼前这段,那就别装 —— 直接把全文送进剪贴板,弹一句人话。
   * 只在这一栏拦:事件来自输入框(比如右栏聊天框)时一律放行,让它们用原生那套。
   */
  function onPaneKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') {
      patchUi({ showButton: false }) // 键盘一动手先把旧浮钮收起来,选完(keyup)再重新露脸
      return
    }
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
    e.preventDefault()
    if (text === '') return
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        patchUi({ copiedAll: true })
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
        copiedTimerRef.current = setTimeout(() => patchUi({ copiedAll: false }), 2000)
      })
      .catch(() => {})
  }

  /** 整份引用:把这份代码整个挂到右栏输入框上(按一轮的引用额度裁,正文是全文) */
  const wholeRef = useMemo(
    () => planWholeFileRef({ text, refLimit, canAddRef }),
    [text, refLimit, canAddRef]
  )

  function addWholeRef(): void {
    if (!wholeRef.canAdd || wholeRef.code.trim() === '') return
    onAddRef({
      relPath: file.relPath,
      startLine: wholeRef.startLine,
      endLine: wholeRef.endLine,
      code: wholeRef.code
    })
    patchUi({ added: true })
    window.setTimeout(() => patchUi({ added: false }), 1000)
  }

  const label = sel
    ? refButtonLabel({
        canAddRef,
        refLimit,
        charCap: CODE_REF_CHARS_MAX,
        startLine: sel.startLine,
        endLine: sel.endLine,
        charCount: sel.code.length
      })
    : ''

  return (
    <div className="code-pane soft-in" onKeyDown={onPaneKeyDown}>
      <div className="code-pane-head">
        <span className="code-pane-icon" aria-hidden="true">
          <TreeIcon name={file.summary?.icon ?? 'file'} size={15} />
        </span>
        <span
          className="code-pane-name mono is-file-menu"
          title={`${file.relPath};右键:复制路径 / 在资源管理器中显示 / 备注`}
          onContextMenu={(e) => {
            // 已经在预览它了,左键就不折腾;右键把菜单开在鼠标处,带路两件 + 备注系列
            e.preventDefault()
            openFilePathMenuFor(rootPath, file.relPath, e.clientX, e.clientY, noteMenu)
          }}
        >
          {file.relPath}
        </span>
        {result?.status === 'ok' && text !== '' && (
          <button
            type="button"
            className="btn btn-ghost code-pane-ref"
            disabled={!wholeRef.canAdd}
            onClick={addWholeRef}
            title={wholeRef.title}
          >
            <TreeIcon name="clip" size={12} />
            {added ? '已引用' : wholeRef.label}
          </button>
        )}
        <button type="button" className="btn btn-ghost code-pane-exit" onClick={onClose}>
          退出预览
        </button>
      </div>
      {err && <Notice kind="error">{err}</Notice>}
      {!err && !result && (
        <div className="card-waiting">
          <ProgressDots />
          正在读文件……
        </div>
      )}
      {!err && result && result.status !== 'ok' && <p className="code-pane-note">{result.reason}</p>}
      {!err && result?.status === 'ok' && (
        <>
          {copiedAll && <p className="code-pane-note">全文已复制到剪贴板</p>}
          <div
            className="code-view"
            ref={codeViewRef}
            tabIndex={0}
            aria-label={`${file.relPath} 的内容预览,全文可滚;选中一段可以引用给小探针;按 Ctrl+A 复制全文`}
            onScroll={onScroll}
          >
            {/* 虚拟滚动:轨道撑出全文的行程,可视段整体平移到当前位置 —— 全文随便滚,元素只有一屏 */}
            <div className="code-track" style={{ height: total * lineHeight }}>
              <div className="code-row" style={{ transform: `translateY(${offsetY}px)` }}>
                <pre className="code-gutter" aria-hidden="true">
                  {gutter}
                </pre>
                <pre className="code-text" ref={codeTextRef}>
                  {chunk}
                </pre>
              </div>
            </div>
          </div>
        </>
      )}
      {sel && (
        <>
          {/* 从哪开始、到哪结束:一正一反的角括号,贴在第一个字左边、最后一个字右边 */}
          <span className="code-mark is-start" style={{ left: `${sel.startX}px`, top: `${sel.startY}px` }} aria-hidden="true">
            <TreeIcon name="markStart" size={13} />
          </span>
          <span className="code-mark is-end" style={{ left: `${sel.endX}px`, top: `${sel.endY}px` }} aria-hidden="true">
            <TreeIcon name="markEnd" size={13} />
          </span>
          {/* 左缘竖线:一眼看出这一段是一个整体 */}
          <span
            className="code-sel-bar"
            style={{ left: `${sel.barLeft}px`, top: `${sel.barTop}px`, height: `${sel.barHeight}px` }}
            aria-hidden="true"
          />
        </>
      )}
      {sel && showButton && (
        <button
          type="button"
          className="code-select-btn"
          style={{ left: `${Math.round(sel.buttonX)}px`, top: `${Math.round(sel.buttonY)}px` }}
          disabled={!canAddRef}
          title={canAddRef ? '把选中的代码引用给小探针' : `一轮最多引用 ${refLimit} 段`}
          // 按下时别让浏览器动选区:一按就折叠的话,这个按钮会先被卸载,click 就丢了
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onAddRef({ relPath: file.relPath, startLine: sel.startLine, endLine: sel.endLine, code: sel.code })
            window.getSelection()?.removeAllRanges()
            setSelAt({ file: file.relPath, sel: null })
            patchUi({ showButton: false })
          }}
        >
          {label}
        </button>
      )}
    </div>
  )
}
