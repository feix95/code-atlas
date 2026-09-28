import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatCodeRef, FilePreviewResult, ScanFileNode } from '@shared/types'
import { HL_KINDS } from '@shared/highlight'
import { CODE_REF_CHARS_MAX } from '@shared/aiDefaults'
import { CH } from '@shared/ipcChannels'
import { DRAG_MIME_REF, type DragRefPayload } from '@shared/dragTypes'
import { visibleLineRange } from '@shared/preview'
import { friendlyErr } from '../errText'
import { refButtonLabel, selectionGeometry, type SelectionGeometry } from '../selectionMarks'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'
import { TreeIcon } from './Icons'
import { MiniMD } from './MiniMD'
import { openFilePathMenuFor, type FilePathNoteActions } from './filePathMenuStore'
import { openContextMenu, type ContextMenuItem } from './contextMenuStore'
import type { FileLinkTarget } from '@shared/fileLinks'
import { canReadingMode, type PaneViewMode } from '../paneTabs'
import { loadCodeWrapOn, saveCodeWrapOn } from '../codePrefs'
import { getDocZoom, setDocZoom, useDocZoom } from '../docZoom'
import { DOC_ZOOM_STEP } from '@shared/docZoom'

/** 「一闪而过」小开关的亮灯时长(P2-1):整条复制提示停久一点,引用落袋提示短停 */
const COPIED_ALL_MS = 2000
/** 头部文件图标(和文件树 15px 同款岗,户口在 FileTree 的 TREE_ICON_SIZE) */
const FILE_ICON_SIZE = 15
/** 头部折行开关图标 */
const WRAP_ICON_SIZE = 16
/** 选区首尾角括号一对(markStart/markEnd)的尺寸 */
const MARK_ICON_SIZE = 16
/**
 * 折行模式的行数闸:折行要放弃虚拟滚动、全量上 DOM(行高不一,轨道没法再按行数乘出来),
 * 超过这个行数开关直接歇着,继续不折行那套。
 */
const WRAP_MAX_LINES = 5000
/** 单行字数闸:超过就只跳语法着色(超长行多是打包产物/单行 JSON,上色纯属白烧) */
const LINE_HL_MAX_CHARS = 5000
/** 滚轮一格的像素门槛 / 碎步账的保鲜期(Ctrl+滚轮文档缩放用,和界面缩放滚轮同脾气) */
const WHEEL_NOTCH = 100
const WHEEL_ACC_TTL_MS = 400

/** 选中的一段 + 它四样东西的落点(第一百一十四锤) */
interface Selection extends SelectionGeometry {
  startLine: number
  endLine: number
  code: string
}

// realm 铁律:预览签被拖进子窗后,选区/事件都活在子窗 document 里 ——
// 一律经元素的 ownerDocument 这族取,别摸全局 window(那是主窗的,子窗里选不中、监不到)
function viewOf(el: HTMLElement | null): Window | null {
  return el?.ownerDocument.defaultView ?? null
}

function docOf(el: HTMLElement | null): Document {
  return el?.ownerDocument ?? document
}

/**
 * 折叠版选区拿光标位置的矩形:端点压行首/行块边界时,rects 数组两头会混进
 * 零宽碎块(上一行的尾巴),首尾标记认真实光标位比认数组头尾稳。拿不到就回 null 走老路。
 */
function caretRect(range: Range, atStart: boolean): DOMRect | null {
  const c = range.cloneRange()
  c.collapse(atStart)
  return c.getClientRects()[0] ?? null
}

/**
 * 选区端点落在第几行:顺着 DOM 往上找最近的 .code-line,读它身上的 data-line 就是真行号
 * (折行版这锤)—— 不再数换行偏移,跟 DOM 怎么分包、折不折行都没有关系。
 * isEnd=true 时多一道「压行首」判定:收尾正好顶在下一行行首、一个它的字都没选中,
 * 那一行不算进来(老换行数账的口径,原样保留)。
 */
function lineNoAt(el: HTMLElement, node: Node, offset: number, isEnd: boolean): number | null {
  if (!el.contains(node)) return null
  const ownerLine = (lineEl: Element, atStart: boolean): number | null => {
    const n = Number((lineEl as HTMLElement).dataset.line)
    if (!Number.isFinite(n)) return null
    return isEnd && atStart && n > 1 ? n - 1 : n
  }
  if (node === el) {
    // 端点落在正文容器自己身上(拖选收尾常见):offset 是孩子序号,位置落在第 offset 个行块之前
    const kids = el.children
    if (kids.length === 0) return null
    const kid = kids[Math.max(0, Math.min(isEnd ? offset - 1 : offset, kids.length - 1))]
    return kid && kid.nodeType === 1 ? ownerLine(kid, false) : null
  }
  // 不用 instanceof HTMLElement:子窗 DOM 的户口在子窗 realm,主窗构造器认不出 —— 看 nodeType 数值最稳
  for (let cur: Node | null = node; cur && cur !== el; cur = cur.parentNode) {
    if (cur.nodeType !== 1) continue
    const ce = cur as HTMLElement
    if (!ce.classList.contains('code-line')) continue
    let atStart = false
    if (isEnd && offset === 0) {
      if (cur === node) {
        atStart = true // 端点是行元素本身,offset0 = 行首
      } else {
        // 端点是文本节点:它是这一行的第一个文本子孙才算压行首
        let probe: Node | null = ce.firstChild
        while (probe && probe.nodeType !== 3) probe = probe.firstChild ?? probe.nextSibling
        atStart = probe === node
      }
    }
    return ownerLine(ce, atStart)
  }
  return null
}

/**
 * 一行分色(预览分色这锤):按主进程给的段落账把这一行切成带色的小段,
 * 段与段之间的空隙是没角色的正文。没有账、账对不上都老实整行原色 ——
 * 化妆只许锦上添花,不许把字吃掉。
 */
function renderColoredLine(lineText: string, segs: number[][] | undefined): React.ReactNode[] {
  // 超闸长行跳过着色:单行几千字多是压缩产物,切小段纯属白烧 DOM
  if (lineText === '' || lineText.length > LINE_HL_MAX_CHARS || !segs || segs.length === 0)
    return [<span key="w">{lineText}</span>]
  const parts: React.ReactNode[] = []
  let pos = 0
  segs.forEach((seg, i) => {
    if (!Array.isArray(seg) || seg.length < 3) return
    const s = Math.max(pos, Math.min(lineText.length, seg[0]))
    const e = Math.max(s, Math.min(lineText.length, seg[1]))
    if (e <= s) return
    if (s > pos) parts.push(<span key={`t${i}`}>{lineText.slice(pos, s)}</span>)
    const cls = HL_KINDS[seg[2]]
    parts.push(
      <span key={`k${i}`} className={cls ? `tok-${cls}` : undefined}>
        {lineText.slice(s, e)}
      </span>
    )
    pos = e
  })
  if (pos < lineText.length) parts.push(<span key="tail">{lineText.slice(pos)}</span>)
  return parts
}

/**
 * 代码预览(第一百一十锤):树上右键「预览文件」后,左栏从目录树换成这扇只读的文本窗。
 * 只摆纯文本 + 行号 —— 不描语法色(那是另一锤的事),看得清、选得中就行。
 * 正文只活在这个组件的 state 里:退出预览组件一卸,内容跟着就走,不留垃圾。
 * 不可预览的情况(二进制/超大/读不了)老实说明白,绝不硬塞一屏乱码。
 * 第一百一十一锤:选中一段代码可以挂进对话当引用 —— 两个出口:右键菜单
 * 「引用到对话」、选中直拖进对话面板;挂上就是输入舱里的引用原子
 * (选区浮钮在折行版退役:太隐蔽,定位还跟折行行块打架)。
 * 第一百一十四锤:选区美术 —— 选中色跟辅助色走,首尾各一枚角括号,左缘一条竖线;
 * 顶栏给一颗钮,把整份代码挂到右栏对话(第一百一十四锤补2)。
 * 全文预览(2026-09-13):虚拟滚动 —— 全文在手,轨道撑出全文行程,画面只画可视区一截;
 * 行数/字数两道闸退役,Ctrl+A 改成复制全文。
 * 预览分色(2026-09-14):主进程拿 tree-sitter 解析出「哪几个字是什么角色」,每行一个
 * span 按段落账上色(tok-*,色号抄 VS Code 官方 Dark+/Light+,跟界面深浅色联动);
 * 行高一点没动;选中引用的行号曾用 TreeWalker 数全文偏移(折行版后已换成读 data-line)。
 * 折行版:头部折行开关,文档型后缀(md/txt 等)默认开 —— 行块化、自然折行、行号走
 * CSS 生成内容(进不了选区);行数超闸的文件不让折行,继续虚拟滚动横滚;
 * 选区行号从「数换行偏移」换成「读行块 data-line」,两种模式同一套。
 */
export function CodePreview({
  rootPath,
  file,
  canAddRef,
  refLimit,
  onAddRef,
  jump,
  noteMenu,
  viewMode,
  onSetViewMode,
  fileLinks
}: {
  rootPath: string
  file: ScanFileNode
  /** 引用额度还没用满(满了浮钮就说清楚,不装作没反应) */
  canAddRef: boolean
  /** 一轮最多引几段(跟主进程同一个数) */
  refLimit: number
  onAddRef: (ref: ChatCodeRef) => void
  /** 跳到第几行(聊天里的文件链接点的):正文载入后滚过去,行号越界夹到文件边缘;seq 变了再跳一次 */
  jump?: { line: number; seq: number } | null
  /** 备注三件套(菜单统一大锤):头部文件名右键菜单带上写/清备注,跟树里、聊天里一个规格 */
  noteMenu?: FilePathNoteActions
  /** 看片档位(阅读模式这锤):undefined/'source' = 源码;'reading' = md 渲染态(只对 md 系生效) */
  viewMode?: PaneViewMode
  /** 头部「阅读/代码」快速开关:切本签的看片档(账在页签身上,和右键菜单同一份) */
  onSetViewMode?: (mode: PaneViewMode) => void
  /** 阅读模式里的文件链接通道:工作区签传它,md 里对得上户口的文件名渲染成可点链接 */
  fileLinks?: FileLinkTarget | null
}): React.JSX.Element {
  const codeTextRef = useRef<HTMLPreElement>(null)
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
  /** 选区记号:选了哪段,记在哪个文件上 */
  const [selAt, setSelAt] = useState<{ file: string; sel: Selection | null }>({
    file: '',
    sel: null
  })
  const sel = selAt.file === file.relPath ? selAt.sel : null
  /** 「已复制」一闪而过小开关的账(浮钮已随折行版退役,引用入口只剩右键菜单与直拖) */
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
  // ── 虚拟滚动(全文预览这锤):全文在手,画面只画可视区那一截 ──
  const [lineHeight, setLineHeight] = useState(20)
  /** 滚动位滚到哪儿,记在哪份文件名下:换文件自动回楼顶 */
  const [scrollAt, setScrollAt] = useState<{ file: string; top: number }>({ file: '', top: 0 })
  const scrollTop = scrollAt.file === file.relPath ? scrollAt.top : 0
  const [viewportHeight, setViewportHeight] = useState(0)
  const scrollRafRef = useRef(0)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * 折行开关(全局默认开这锤):一个开关管所有文件,存 localStorage 重启不失忆;
   * 折行放弃虚拟滚动、全量行块上 DOM —— 所以过行数闸的文件开关摁不动。
   */
  const [wrapOn, setWrapOn] = useState(loadCodeWrapOn)

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
  /** 分色账(预览分色这锤):主进程按行给好的段落;没有 = 这份不上色,白字照常 */
  const colors = result?.status === 'ok' ? result.colors : undefined

  // 全文在手:按行切一份备用(纯字符串,不占画面);折行时全量上屏,不折行只画 range 那一截
  const lines = useMemo(() => (text === '' ? [] : text.split('\n')), [text])
  const total = lines.length
  // 折行(全局默认开这锤):偏好一档管所有文件;超过行数闸一律摁死(回退横滚)
  const wrapAllowed = total > 0 && total <= WRAP_MAX_LINES
  const wrap = wrapAllowed && wrapOn
  // 阅读模式(这锤的新档):md 系签才生效 —— MiniMD 渲染态,行号/分色/选区引用是源码档的家务
  const reading = viewMode === 'reading' && canReadingMode(file.relPath)
  // 文档字号缩放(Ctrl+滚轮这锤):系数落 --doc-zoom,正文各行 font-size 乘它
  const docZoom = useDocZoom()

  // 行高只量一次:等宽字体行行等高,量准一次,全文的滚动高度就是它乘出来的。
  // 界面缩放改了根字号,行高跟着变,重量一遍。
  useLayoutEffect(() => {
    const pre = codeTextRef.current
    const win = viewOf(pre) ?? window
    const measure = (): void => {
      const el = codeTextRef.current
      if (!el) return
      const lh = Number.parseFloat(win.getComputedStyle(el).lineHeight)
      if (Number.isFinite(lh) && lh > 0) setLineHeight(lh)
    }
    measure()
    win.addEventListener(CH.uiScaleChanged, measure)
    return () => win.removeEventListener(CH.uiScaleChanged, measure)
    // docZoom 变档也得重量:字号乘了系数,行高跟着变
  }, [result, docZoom])

  // Ctrl+滚轮 = 文档字号缩放(docZoom,小葵定的分工:界面缩放只吃键盘 +/-/0)。
  // 监听器挂预览元素本身 —— 天然 realm-safe(子窗签的滚轮事件在子窗文档里转,沾不到全局 window);
  // 碎步积累成整档才翻、隔久清账,触控板捏合在 Chromium 里也报 ctrl+wheel,捏合白捡。
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
    // 阅读模式不跳行:行号地图是源码档的账(渲染态的「行」是排版后的事)
    if (!jump || result?.status !== 'ok' || total === 0 || reading) return
    const raf = requestAnimationFrame(() => {
      const el = codeViewRef.current
      if (!el) return
      const target = Math.min(Math.max(jump.line, 1), total)
      // 折行模式行高不一,乘法失效 —— 直接找到那一行的行块量真实位置
      if (wrap) {
        const lineEl = codeTextRef.current?.querySelector(`[data-line="${target}"]`)
        if (lineEl) {
          el.scrollTop +=
            lineEl.getBoundingClientRect().top -
            el.getBoundingClientRect().top -
            el.clientHeight / 3
        }
        return
      }
      el.scrollTop = Math.max(0, (target - 1) * lineHeight - el.clientHeight / 3)
    })
    return () => cancelAnimationFrame(raf)
  }, [jump, result, total, lineHeight, wrap, reading])

  // 该画哪几行(纯函数) + 这一段的正文和行号格子;轨道总高 = 总行数 × 行高,滚动条行程是全文的
  const range = visibleLineRange({ scrollTop, viewportHeight, lineHeight, totalLines: total })
  const offsetY = (range.start - 1) * lineHeight
  const chunkLines = useMemo(
    () => (total === 0 ? [] : lines.slice(range.start - 1, range.end)),
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
    const s = viewOf(el)?.getSelection()
    if (!el || !s || s.isCollapsed || s.rangeCount === 0 || !el.contains(s.anchorNode)) return null
    const anchorNode = s.anchorNode
    const focusNode = s.focusNode
    if (!anchorNode || !focusNode || !el.contains(anchorNode) || !el.contains(focusNode))
      return null
    const code = s.toString()
    if (code.trim() === '') return null
    const r = s.getRangeAt(0)
    const rects = Array.from(r.getClientRects())
    const geom = selectionGeometry(rects)
    if (!geom) return null
    // 行号读行块身上的 data-line:两端各自认门,反向选、跨行选、端点压元素边界都对
    const startLine = lineNoAt(el, r.startContainer, r.startOffset, false)
    const endLine = lineNoAt(el, r.endContainer, r.endOffset, true)
    if (startLine === null || endLine === null) return null
    // 首尾标记与竖线顶边改认折叠光标位:行首起选时 rects[0] 是上一行末尾的碎块,
    // 认它首标记就画错行;光标位拿不到时回退矩形账
    const startC = caretRect(r, true)
    const endC = caretRect(r, false)
    const lastRect = rects[rects.length - 1]
    const barTop = startC?.top ?? geom.barTop
    const barBottom = lastRect?.bottom ?? barTop
    // 末标记同理,但收在下一行行首的光标不算数(那儿一个字没选)——钉回末行尾巴
    const endByCaret = endC !== null && lastRect !== undefined && endC.top < lastRect.bottom
    return {
      ...geom,
      startX: startC?.left ?? geom.startX,
      startY: startC ? (startC.top + startC.bottom) / 2 : geom.startY,
      endX: endByCaret ? endC.right : geom.endX,
      endY: endByCaret ? (endC.top + endC.bottom) / 2 : geom.endY,
      barTop,
      barHeight: Math.max(barBottom - barTop, 2),
      startLine,
      endLine,
      code
    }
  }, [])

  /** 记号跟着选区走(拖到哪儿标到哪儿),返回算好的这一份 */
  const followSelection = useCallback((): Selection | null => {
    const next = computeSelection()
    setSelAt({ file: file.relPath, sel: next })
    return next
  }, [computeSelection, file.relPath])

  // 选区一变就重画记号;选区没了,记号跟着收
  useEffect(() => {
    if (result?.status !== 'ok') return
    const onSelectionChange = (): void => {
      followSelection()
    }
    const doc = docOf(codeTextRef.current)
    doc.addEventListener('selectionchange', onSelectionChange)
    return () => doc.removeEventListener('selectionchange', onSelectionChange)
  }, [result, followSelection])

  // 滚动/改窗口大小会让视口坐标失效:重算落点,整个选区滚出视野时记号自然收起来。
  useEffect(() => {
    const view = codeViewRef.current
    let frame = 0
    const reposition = (): void => {
      frame = 0
      followSelection()
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(reposition)
    }
    const win = viewOf(view) ?? window
    win.addEventListener('resize', schedule)
    view?.addEventListener('scroll', schedule, { passive: true })
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      win.removeEventListener('resize', schedule)
      view?.removeEventListener('scroll', schedule)
    }
  }, [result, followSelection])

  /**
   * Ctrl+A 复制全文(全文预览这锤):虚拟滚动后元素里只有一屏,浏览器的「全选」最多
   * 选到眼前这段,那就别装 —— 直接把全文送进剪贴板,弹一句人话。
   * 只在这一栏拦:事件来自输入框(比如右栏聊天框)时一律放行,让它们用原生那套。
   */
  /** 折行开关一个口:按钮和 Alt+Z 都走这里,偏好当场落盘 */
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
    // Alt+Z 切自动换行(VS Code 同款键位):只在预览焦点下生效,别拦别处的快捷键
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

  /**
   * 把选区挂成对话引用(浮钮和右键菜单同走这一条):挂上 → 清选区 → 收浮钮。
   * 落到哪个页签、闪不闪它,是 onAddRef(App 侧 addPreviewRef)的事。
   */
  const quoteSelection = useCallback(
    (s: Selection): void => {
      onAddRef({
        relPath: file.relPath,
        startLine: s.startLine,
        endLine: s.endLine,
        code: s.code
      })
      viewOf(codeTextRef.current)?.getSelection()?.removeAllRanges()
      setSelAt({ file: file.relPath, sel: null })
    },
    [file.relPath, onAddRef]
  )

  /** 选区上右键(选中引用右键入口):引用了就挂,「复制选中段」顺带补上原生菜单缺的那口 */
  function onCodeContextMenu(e: React.MouseEvent<HTMLDivElement>): void {
    const s = computeSelection()
    if (!s) return // 右键没点在选区上:不拦、不摆空菜单
    e.preventDefault()
    const items: ContextMenuItem[] = []
    if (refLimit > 0) {
      items.push({
        label: refButtonLabel({
          canAddRef,
          refLimit,
          charCap: CODE_REF_CHARS_MAX,
          startLine: s.startLine,
          endLine: s.endLine,
          charCount: s.code.length
        }),
        disabled: !canAddRef,
        run: () => quoteSelection(s)
      })
    }
    items.push({
      label: '复制选中段',
      run: () =>
        navigator.clipboard
          .writeText(s.code)
          .then(() => '已复制 ✓')
          .catch(() => '没复制成,剪贴板被顶住了')
    })
    openContextMenu({ x: e.clientX, y: e.clientY, doc: e.currentTarget.ownerDocument, items })
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

  /** 选中一段直接拖去对话挂引用:正文自包含(dataTransfer 里连字带行号),松手那头不用读盘 */
  function onCodeDragStart(e: React.DragEvent<HTMLDivElement>): void {
    const s = computeSelection()
    if (!s || refLimit === 0) return
    const ref: DragRefPayload = {
      relPath: file.relPath,
      startLine: s.startLine,
      endLine: s.endLine,
      code: s.code
    }
    e.dataTransfer.setData(DRAG_MIME_REF, JSON.stringify(ref))
    e.dataTransfer.setData('text/plain', s.code)
    e.dataTransfer.effectAllowed = 'copy'
  }

  /**
   * 阅读/代码快速开关(和页签右键菜单同一份 viewMode 账):图标换脸标态 ——
   * bookOpen = 正读渲染稿,code = 正看源码;非 md 文件常驻置灰(菜单同款口径)。
   * 页头栏两档共用同一排钮,位置样式一模一样(小葵拍板:这俩是预览页公用功能)
   */
  const canRead = canReadingMode(file.relPath)
  const modeBtn: React.JSX.Element = (
    <button
      type="button"
      className="code-mode-btn"
      disabled={!canRead}
      aria-pressed={reading}
      aria-label={reading ? '切到代码模式' : '切到阅读模式'}
      data-tip={!canRead ? 'Markdown 文件专属' : reading ? '当前:阅读模式' : '当前:代码模式'}
      onClick={() => onSetViewMode?.(reading ? 'source' : 'reading')}
    >
      <TreeIcon name={reading ? 'bookOpen' : 'code'} size={WRAP_ICON_SIZE} />
    </button>
  )

  return (
    <div className="code-pane soft-in" onKeyDown={onPaneKeyDown}>
      {/* 页头栏:两档共用一排(文件名 + 模式开关 + 换行钮),阅读档的内联标题
          是文档正文的title,跟页头 chrome 不冲突 */}
      <div className="code-pane-head">
        <span className="code-pane-icon" aria-hidden="true">
          <TreeIcon name={file.summary?.icon ?? 'file'} size={FILE_ICON_SIZE} />
        </span>
        <span
          className="code-pane-name mono is-file-menu"
          onContextMenu={(e) => {
            // 已经在预览它了,左键就不折腾;右键把菜单开在鼠标处,带路两件 + 备注系列
            e.preventDefault()
            openFilePathMenuFor(
              rootPath,
              file.relPath,
              e.clientX,
              e.clientY,
              e.currentTarget.ownerDocument,
              noteMenu ? { note: noteMenu } : undefined
            )
          }}
        >
          {file.relPath}
        </span>
        {result?.status === 'ok' && onSetViewMode && modeBtn}
        {result?.status === 'ok' && (
          <button
            type="button"
            className={`code-wrap-btn${wrap ? ' is-on' : ''}`}
            disabled={!wrapAllowed}
            aria-pressed={wrap}
            aria-label="自动换行(Alt+Z)"
            data-tip={
              !wrapAllowed
                ? `这份文件超过 ${WRAP_MAX_LINES} 行,折行要全量上屏会卡,先歇着`
                : wrap
                  ? '当前:自动换行'
                  : '当前:不换行'
            }
            onClick={toggleWrap}
          >
            {/* 状态走图标换脸(小葵拍板,不靠底色):折回箭头 = 开着,参差行尾 = 关着 */}
            <TreeIcon name={wrap ? 'wrapText' : 'textAlignStart'} size={WRAP_ICON_SIZE} />
          </button>
        )}
      </div>
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
            /* 阅读模式(这锤的新档):md 系签的渲染态 —— MiniMD 排版进可读栏,
               行号/分色/选区引用是源码档的家务,这边只管「读」 */
            <div
              className="code-view is-reading"
              ref={codeViewRef}
              tabIndex={0}
              style={{ '--doc-zoom': docZoom } as React.CSSProperties}
              aria-label={`${file.relPath} 的阅读模式,全文可滚;按 Ctrl+A 复制全文`}
              onScroll={onScroll}
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
            <div
              className="code-view"
              ref={codeViewRef}
              tabIndex={0}
              style={{ '--doc-zoom': docZoom } as React.CSSProperties}
              aria-label={`${file.relPath} 的内容预览,全文可滚;选中一段可以引用到对话;按 Ctrl+A 复制全文`}
              onScroll={onScroll}
              onContextMenu={onCodeContextMenu}
              onDragStart={onCodeDragStart}
            >
              {wrap ? (
                /* 折行模式(折行版这锤):行高不一,虚拟滚动让位 —— 行块全量上屏、自然折行;
                 行号是行块左槽的 ::before(CSS 生成内容,进不了 DOM 文本,选区/引用都不会沾到数字) */
                <pre
                  className="code-text is-wrap"
                  ref={codeTextRef}
                  style={{ '--gc': `${String(total).length}ch` } as React.CSSProperties}
                >
                  {lines.map((lineText, i) => (
                    <span key={i + 1} className="code-line" data-line={i + 1}>
                      {renderColoredLine(lineText, colors?.[i])}
                    </span>
                  ))}
                </pre>
              ) : (
                /* 虚拟滚动:轨道撑出全文的行程,可视段整体平移到当前位置 —— 全文随便滚,元素只有一屏。
                 分色(预览分色这锤):每行一个 span、行内按段落账上色;行高一点没动,
                 虚拟滚动「量一次行高」的老地基本字不摇 */
                <div className="code-track" style={{ height: total * lineHeight }}>
                  <div className="code-row" style={{ transform: `translateY(${offsetY}px)` }}>
                    <pre className="code-gutter" aria-hidden="true">
                      {gutter}
                    </pre>
                    <pre className="code-text" ref={codeTextRef}>
                      {chunkLines.map((lineText, i) => {
                        const lineNo = range.start + i
                        return (
                          <span key={lineNo} className="code-line" data-line={lineNo}>
                            {renderColoredLine(lineText, colors?.[lineNo - 1])}
                            {'\n'}
                          </span>
                        )
                      })}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {sel && (
        <>
          {/* 从哪开始、到哪结束:一正一反的角括号,贴在第一个字左边、最后一个字右边 */}
          <span
            className="code-mark is-start"
            style={{ left: `${sel.startX}px`, top: `${sel.startY}px` }}
            aria-hidden="true"
          >
            <TreeIcon name="markStart" size={MARK_ICON_SIZE} />
          </span>
          <span
            className="code-mark is-end"
            style={{ left: `${sel.endX}px`, top: `${sel.endY}px` }}
            aria-hidden="true"
          >
            <TreeIcon name="markEnd" size={MARK_ICON_SIZE} />
          </span>
          {/* 左缘竖线:一眼看出这一段是一个整体 */}
          <span
            className="code-sel-bar"
            style={{
              left: `${sel.barLeft}px`,
              top: `${sel.barTop}px`,
              height: `${sel.barHeight}px`
            }}
            aria-hidden="true"
          />
        </>
      )}
    </div>
  )
}
