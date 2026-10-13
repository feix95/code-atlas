// 底部浮动工具栏:最小积木工具。当前有 移动(V)、矩形(R)、直线(L),登记在 TOOLS 一处。
// 图标为 lucide-static v0.469.0 原始路径数据(24×24 网格): select=mouse-pointer-2,
// rect=square,line=slash;strokeWidth 1.8 使 32px 渲染下视觉描边恰为 2.4px。
// 悬浮可拖:栏是弹性一体件,两端各一个栏内「格位」平时宽 0 收起,悬到端部时
// 格位撑开、六点抓手淡入,栏本体随之变长(底色/描边/圆角/阴影同出一身);
// 左端展开用负 margin 让栏向左长,工具不动;格位/触发条按下即拖,位置写 localStorage 重启沿用。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CanvasTool } from '../../uiWorkbench/useCanvasTools'

const TOOLS: readonly { tool: CanvasTool; label: string; hotkey: string }[] = [
  { tool: 'select', label: '移动', hotkey: 'V' },
  { tool: 'rect', label: '矩形', hotkey: 'R' },
  { tool: 'line', label: '直线', hotkey: 'L' }
]

const TOOL_ICONS: Record<CanvasTool, React.JSX.Element> = {
  select: (
    <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
  ),
  rect: <rect width="18" height="18" x="3" y="3" rx="2" />,
  line: <path d="M22 2 2 22" />
}

/* 存储格式 v2:栏「收起态中心」在工作区框里的归一化比例(fx/fy ≈ 0~1)。
   容器改尺寸时按同一比例重算像素——缩窗自动往界内收、放窗自动弹回原位;
   旧版 {x,y} 像素存档在挂载时读出来、换算成比例一次性迁移 */
const POS_KEY = 'uwb-toolbar-pos'
interface ToolbarPos {
  x: number
  y: number
}
interface ToolbarFrac {
  fx: number
  fy: number
}
type GripSide = 'l' | 'r'

function loadFrac(): ToolbarFrac | ToolbarPos | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<ToolbarFrac & ToolbarPos>
    if (Number.isFinite(p.fx) && Number.isFinite(p.fy))
      return { fx: p.fx as number, fy: p.fy as number }
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x as number, y: p.y as number }
    return null
  } catch {
    return null
  }
}

function ToolIcon({ tool }: { tool: CanvasTool }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="32"
      height="32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TOOL_ICONS[tool]}
    </svg>
  )
}

/** 六点抓手:lucide grip-vertical 的 2×3 点位,实心小圆点 */
function GripDots(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="24" height="32" fill="currentColor" aria-hidden="true">
      {[9, 15].map((cx) =>
        [5, 12, 19].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" />)
      )}
    </svg>
  )
}

/** 收起态尺寸:展开格位的宽度(--uwb-grip-w,计算样式里可能是 rem/px)不记入
    比例换算,免得悬停展开本身挪走基准;读不到就回落到 rem 直算 */
function collapsedSize(bar: HTMLElement): { w: number; h: number } {
  const doc = bar.ownerDocument
  const win = doc.defaultView
  const rem = win ? parseFloat(win.getComputedStyle(doc.documentElement).fontSize) || 16 : 16
  const raw = win ? win.getComputedStyle(bar).getPropertyValue('--uwb-grip-w').trim() : ''
  const gripW = raw.endsWith('rem') ? parseFloat(raw) * rem : parseFloat(raw) || 1.375 * rem
  const expanded = /is-(?:grip|dragging)-[lr]/.test(bar.className)
  return { w: bar.offsetWidth - (expanded ? gripW : 0), h: bar.offsetHeight }
}

/** 工具栏可及范围 = 整个工作区:左缘 = rail 右缘(可压侧栏,压不到 rail),其余三缘 = .app-body */
function workAreaBox(bar: HTMLElement): {
  left: number
  top: number
  right: number
  bottom: number
} {
  const win = bar.ownerDocument.defaultView
  const body = bar.closest('.app-body')
  const b = body?.getBoundingClientRect()
  const rail = body?.querySelector('.rail')?.getBoundingClientRect()
  return {
    left: rail?.right ?? b?.left ?? 0,
    top: b?.top ?? 0,
    right: b?.right ?? win?.innerWidth ?? 0,
    bottom: b?.bottom ?? win?.innerHeight ?? 0
  }
}

/** 中心比例 → 收起态 css 像素(相对定位锚),全程钳在工作区框内 */
function fracToCss(bar: HTMLElement, f: ToolbarFrac): ToolbarPos {
  const box = workAreaBox(bar)
  const parent = (bar.offsetParent as HTMLElement).getBoundingClientRect()
  const { w, h } = collapsedSize(bar)
  const x = box.left + f.fx * (box.right - box.left) - w / 2
  const y = box.top + f.fy * (box.bottom - box.top) - h / 2
  return {
    x: Math.min(Math.max(x, box.left), box.right - w) - parent.left,
    y: Math.min(Math.max(y, box.top), box.bottom - h) - parent.top
  }
}

/** 收起态 css 像素 → 中心比例(写入存档的格式) */
function cssToFrac(bar: HTMLElement, pos: ToolbarPos): ToolbarFrac {
  const box = workAreaBox(bar)
  const parent = (bar.offsetParent as HTMLElement).getBoundingClientRect()
  const { w, h } = collapsedSize(bar)
  return {
    fx: (parent.left + pos.x + w / 2 - box.left) / (box.right - box.left),
    fy: (parent.top + pos.y + h / 2 - box.top) / (box.bottom - box.top)
  }
}

export function WorkbenchToolbar({
  tool,
  onPick
}: {
  tool: CanvasTool
  onPick: (tool: CanvasTool) => void
}): React.JSX.Element {
  const [pos, setPos] = useState<ToolbarPos | null>(null)
  const [grip, setGrip] = useState<GripSide | null>(null)
  const fracRef = useRef<ToolbarFrac | null>(null)
  const posRef = useRef(pos)
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    posRef.current = pos
  })

  /* 格位展开判定:触发条/格位 pointerenter 点亮;点亮后每次指针移动用 bar 的实时
     包围盒 + 外扩晕区复查,命中栏内元素或在晕区内就续命,否则才熄灭。展开会让
     bar 位移,判定框跟着它走,不会纯 CSS :hover 那样「触发区搬走→丢失→再触发」
     死循环;触发条外探刻意收窄到晕区带(±28)以内,悬停死环由命中目标兜底 */
  useEffect(() => {
    if (!grip) return
    const bar = barRef.current
    const win = bar?.ownerDocument.defaultView
    if (!bar || !win) return
    const move = (e: PointerEvent): void => {
      // 触发条比晕区带更外(外探 --uwb-grip-w > 28px):命中栏内元素(触发条/格位/
      // 工具钮)即续命,不然慢速接近停在晕区带外的死环里,灯亮一下就被熄掉
      const overBar = e.target instanceof win.Element && bar.contains(e.target)
      const r = bar.getBoundingClientRect()
      const inside =
        overBar ||
        (e.clientX >= r.left - 28 &&
          e.clientX <= r.right + 28 &&
          e.clientY >= r.top - 2 &&
          e.clientY <= r.bottom + 2)
      if (!inside) setGrip(null)
    }
    win.addEventListener('pointermove', move)
    return () => win.removeEventListener('pointermove', move)
  }, [grip])

  /* 位置的生命线:挂载(layout 时机,首帧前就落位)读档换算一次;
     之后 .app-body / .sidebar 尺寸一变就按存档比例重算像素——
     缩窗栏自动收进界内,放窗自动弹回同一相对位置,永不被拖丢。
     比例本身只由拖动收尾更新,重算不回写,回弹基准才不会被钳制污染 */
  useLayoutEffect(() => {
    const bar = barRef.current
    const body = bar?.closest('.app-body')
    if (!bar || !body || !(bar.offsetParent instanceof HTMLElement)) return
    const applyFrac = (f: ToolbarFrac): void => {
      const next = fracToCss(bar, f)
      if (posRef.current && posRef.current.x === next.x && posRef.current.y === next.y) return
      fracRef.current = f
      posRef.current = next
      setPos(next)
    }
    const raw = loadFrac()
    if (raw) {
      const f = 'fx' in raw ? raw : cssToFrac(bar, raw)
      localStorage.setItem(POS_KEY, JSON.stringify(f))
      applyFrac(f)
    }
    const ro = new ResizeObserver(() => {
      const f = fracRef.current
      if (f) applyFrac(f)
    })
    ro.observe(body)
    const sidebar = body.querySelector('.sidebar')
    if (sidebar) ro.observe(sidebar)
    return () => ro.disconnect()
  }, [])

  function startGripDrag(e: React.PointerEvent<HTMLDivElement>, side: GripSide): void {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const bar = barRef.current
    const parent = bar?.offsetParent as HTMLElement | null
    const win = e.currentTarget.ownerDocument.defaultView
    if (!bar || !parent || !win) return
    const parentRect = parent.getBoundingClientRect()
    // 拖动范围 = 工作区(可压侧栏/画布/属性面板,压不到 rail),不给出窗口的全域自由
    const box = workAreaBox(bar)
    const grab = {
      x: e.clientX - bar.getBoundingClientRect().left,
      y: e.clientY - bar.getBoundingClientRect().top
    }
    // 左端展开态有负 margin 把栏体左移;存档要存收起态的 css left,扣掉这段位移
    const mLeft = parseFloat(win.getComputedStyle(bar).marginLeft) || 0
    bar.classList.add('is-dragging', `is-dragging-${side}`)
    const prevCursor = win.document.documentElement.style.cursor
    win.document.documentElement.style.cursor = 'grabbing'
    const move = (ev: PointerEvent): void => {
      const x = Math.min(Math.max(ev.clientX - grab.x, box.left), box.right - bar.offsetWidth)
      const y = Math.min(Math.max(ev.clientY - grab.y, box.top), box.bottom - bar.offsetHeight)
      const next = { x: x - parentRect.left - mLeft, y: y - parentRect.top }
      posRef.current = next
      setPos(next)
    }
    const end = (): void => {
      win.removeEventListener('pointermove', move)
      win.removeEventListener('pointerup', end)
      win.removeEventListener('pointercancel', end)
      win.removeEventListener('blur', end)
      win.document.documentElement.style.cursor = prevCursor
      bar.classList.remove('is-dragging', 'is-dragging-l', 'is-dragging-r')
      const f = posRef.current ? cssToFrac(bar, posRef.current) : null
      fracRef.current = f
      if (f) localStorage.setItem(POS_KEY, JSON.stringify(f))
    }
    // 指针捕获:松手在窗口外/边角处也能收到 up,不会把 grabbing 光标和 is-dragging 钉死
    e.currentTarget.setPointerCapture(e.pointerId)
    win.addEventListener('pointermove', move)
    win.addEventListener('pointerup', end)
    win.addEventListener('pointercancel', end)
    win.addEventListener('blur', end)
  }

  /** 离开触发区/格位时灭灯:目标是栏内其他部分(格位、工具)就维持,离开栏体才熄 */
  function leaveGrip(e: React.PointerEvent<HTMLDivElement>): void {
    const rt = e.relatedTarget as Element | null
    if (!rt || !barRef.current?.contains(rt)) setGrip(null)
  }

  return (
    <div
      ref={barRef}
      className={`uwb-toolbar${grip ? ` is-grip-${grip}` : ''}`}
      role="toolbar"
      aria-label="工具栏"
      style={pos ? { left: pos.x, top: pos.y, bottom: 'auto', transform: 'none' } : undefined}
    >
      {/* 隐形触发条:收起态悬端点亮格位;格位在栏内,展开后由晕区复查维持 */}
      <div
        className="uwb-grip-zone is-left"
        onPointerEnter={() => setGrip('l')}
        onPointerLeave={leaveGrip}
        onPointerDown={(e) => startGripDrag(e, 'l')}
      />
      <div
        className="uwb-grip-slot is-left"
        onPointerEnter={() => setGrip('l')}
        onPointerLeave={leaveGrip}
        onPointerDown={(e) => startGripDrag(e, 'l')}
      >
        <button type="button" className="uwb-grip" aria-label="拖动工具栏" tabIndex={-1}>
          <GripDots />
        </button>
      </div>
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          className="uwb-tool"
          aria-label={`${t.label}工具(${t.hotkey})`}
          aria-pressed={tool === t.tool}
          data-tip={`${t.label} (${t.hotkey})`}
          // 鼠标按下不抢焦点:不然点过的按钮挂着焦点,之后按快捷键会补出 focus-visible 蓝环
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(t.tool)}
        >
          <ToolIcon tool={t.tool} />
        </button>
      ))}
      <div
        className="uwb-grip-slot is-right"
        onPointerEnter={() => setGrip('r')}
        onPointerLeave={leaveGrip}
        onPointerDown={(e) => startGripDrag(e, 'r')}
      >
        <button type="button" className="uwb-grip" aria-label="拖动工具栏" tabIndex={-1}>
          <GripDots />
        </button>
      </div>
      <div
        className="uwb-grip-zone is-right"
        onPointerEnter={() => setGrip('r')}
        onPointerLeave={leaveGrip}
        onPointerDown={(e) => startGripDrag(e, 'r')}
      />
    </div>
  )
}
