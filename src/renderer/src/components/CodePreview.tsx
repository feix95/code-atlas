import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatCodeRef, FilePreviewResult, ScanFileNode } from '@shared/types'
import { CODE_REF_CHARS_MAX } from '@shared/aiDefaults'
import { planWholeFileRef, visibleLineRange } from '@shared/preview'
import { friendlyErr } from '../errText'
import { clampButtonX, refButtonLabel, selectionGeometry, type SelectionGeometry } from '../selectionMarks'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'
import { TreeIcon } from './Icons'

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
  jump
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
}): React.JSX.Element {
  const [result, setResult] = useState<FilePreviewResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<Selection | null>(null)
  // 浮钮露不露脸(第一百一十四锤补):拖动中不露,手松开/键盘选完才露
  const [showButton, setShowButton] = useState(false)
  const [added, setAdded] = useState(false)
  const codeTextRef = useRef<HTMLPreElement>(null)
  const codeViewRef = useRef<HTMLDivElement>(null)
  // ── 虚拟滚动(全文预览这锤):全文在手,画面只画可视区那一截 ──
  const [lineHeight, setLineHeight] = useState(20)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [copiedAll, setCopiedAll] = useState(false)
  const scrollRafRef = useRef(0)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 可视区第一行的行号:选区行号 = 这一行 + 选区里的换行数(划中的行号报真号)
  const chunkBaseRef = useRef(1)

  // 组件按 relPath 挂 key:换文件 = 重挂,旧文件的内容不会串到新文件头上
  useEffect(() => {
    let alive = true
    // 路径契约:renderer 只回传 (rootPath, relPath),绝对路径是主进程的事
    window.atlas
      .readPreview(rootPath, file.relPath)
      .then((res) => {
        if (alive) setResult(res)
      })
      .catch((e) => {
        if (alive) setErr(friendlyErr(e))
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
      setScrollTop(codeViewRef.current?.scrollTop ?? 0)
    })
  }, [])
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
  useEffect(() => {
    if (!jump || result?.status !== 'ok') return
    const view = codeViewRef.current
    if (!view || total === 0) return
    const target = Math.min(Math.max(jump.line, 1), total)
    view.scrollTop = Math.max(0, (target - 1) * lineHeight - view.clientHeight / 3)
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
    setSel(next)
    return next
  }, [computeSelection])

  // 选区一变就重画记号;选区没了,浮钮也跟着收
  useEffect(() => {
    if (result?.status !== 'ok') return
    const onSelectionChange = (): void => {
      if (followSelection() === null) setShowButton(false)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [result, followSelection])

  // 滚动/改窗口大小会让视口坐标失效:重算落点,只在整个选区滚出视野时才收起来。
  // (只挪记号,不动浮钮的露脸状态 —— 滚一下不该把它收了。)
  useEffect(() => {
    const view = codeViewRef.current
    let frame = 0
    const reposition = (): void => {
      frame = 0
      if (followSelection() === null) setShowButton(false)
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
  }, [result, followSelection])

  // 选完才算数:鼠标松开、或键盘选完(shift+方向键抬手),这时才把浮钮请出来。
  // 捕获阶段听:鼠标在哪儿松开都收得到(拖到隔壁聊天区放手,也算选完了)。
  useEffect(() => {
    if (result?.status !== 'ok') return
    const onPointerDown = (e: PointerEvent): void => {
      // 点在浮钮自己身上不算「开始新选区」—— 否则它会在 click 之前先消失,点了没反应
      const target = e.target as HTMLElement | null
      if (target?.closest?.('.code-select-btn')) return
      setShowButton(false)
    }
    const onDone = (): void => {
      if (followSelection() !== null) setShowButton(true)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onDone, true)
    window.addEventListener('keyup', onDone, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onDone, true)
      window.removeEventListener('keyup', onDone, true)
    }
  }, [result, followSelection])

  /**
   * Ctrl+A 复制全文(全文预览这锤):虚拟滚动后元素里只有一屏,浏览器的「全选」最多
   * 选到眼前这段,那就别装 —— 直接把全文送进剪贴板,弹一句人话。
   * 只在这一栏拦:事件来自输入框(比如右栏聊天框)时一律放行,让它们用原生那套。
   */
  function onPaneKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') {
      setShowButton(false) // 键盘一动手先把旧浮钮收起来,选完(keyup)再重新露脸
      return
    }
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
    e.preventDefault()
    if (text === '') return
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedAll(true)
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
        copiedTimerRef.current = setTimeout(() => setCopiedAll(false), 2000)
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
    setAdded(true)
    window.setTimeout(() => setAdded(false), 1000)
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
    <div className="code-pane" onKeyDown={onPaneKeyDown}>
      <div className="code-pane-head">
        <span className="code-pane-icon" aria-hidden="true">
          <TreeIcon name={file.summary?.icon ?? 'file'} size={15} />
        </span>
        <span className="code-pane-name mono" title={file.relPath}>
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
            setSel(null)
            setShowButton(false)
          }}
        >
          {label}
        </button>
      )}
    </div>
  )
}
