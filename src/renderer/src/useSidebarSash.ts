// 左栏宽度 + VSCode 式分割条 + 收起旗:宽度存「100% 缩放下的基准值」,渲染时乘缩放系数。
import { useEffect, useRef, useState } from 'react'
import { CH } from '@shared/ipcChannels'
import { CHROME_U_REM, ROOT_FONT_BASE_PX } from '@shared/uiScale'
import {
  DEFAULT_SIDEBAR_WIDTH,
  loadSidebarCollapsed,
  loadSidebarWidth,
  saveSidebarCollapsed,
  saveSidebarWidth
} from './layoutPrefs'

// 左栏宽度:分割条拖多宽记进 localStorage(存 100% 缩放下的基准值,户口在 layoutPrefs),下次打开还是自己调好的样子
export const MIN_SIDEBAR_WIDTH = 240

// 树再宽也不能把右栏挤没:右栏保底 360px 看分析内容
function clampSidebar(width: number): number {
  const max = Math.max(MIN_SIDEBAR_WIDTH + 40, window.innerWidth - 360)
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), max)
}

export function useSidebarSash() {
  const [uiScale, setUiScale] = useState(window.atlas.getUiScale)
  // VSCode 式分割条:左栏宽度跟着鼠标走。存的是「100% 缩放下的基准值」,
  // 渲染宽度 = 基准值 × 缩放系数,面板和文字等比例一起变
  const sidebarBaseRef = useRef(loadSidebarWidth())
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampSidebar(loadSidebarWidth() * window.atlas.getUiScale())
  )
  const sidebarWidthRef = useRef(sidebarWidth)
  const sashDraggingRef = useRef(false)
  // 侧栏收起(UI v3):顶栏最左端那颗钮折叠/放出行中间整列;状态记本机
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed)

  function toggleSidebarCollapsed(): void {
    setSidebarCollapsed((prev) => {
      const next = !prev
      saveSidebarCollapsed(next)
      return next
    })
  }

  function applySidebarWidth(next: number): void {
    const clamped = clampSidebar(next)
    sidebarWidthRef.current = clamped
    sidebarBaseRef.current = clamped / uiScale
    setSidebarWidth(clamped)
  }

  function persistSidebarWidth(): void {
    saveSidebarWidth(sidebarBaseRef.current)
  }

  // 设置页拖了缩放滑条:按基准值 × 新系数重算左栏宽度,重夹一遍边界
  useEffect(() => {
    function onUiScale(e: Event): void {
      const factor = (e as CustomEvent<number>).detail
      setUiScale(factor)
      const clamped = clampSidebar(sidebarBaseRef.current * factor)
      sidebarWidthRef.current = clamped
      setSidebarWidth(clamped)
    }
    window.addEventListener(CH.uiScaleChanged, onUiScale)
    return () => window.removeEventListener(CH.uiScaleChanged, onUiScale)
  }, [])

  // pointer capture:鼠标拖出分割条、甚至拖出窗口,move 事件照样送到条上,不跟丢
  function onSashPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    sashDraggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add('is-sash-dragging')
  }

  function onSashPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!sashDraggingRef.current) return
    // v3 起侧栏左边多了一列 rail(宽 1u):分割条的横向位置先扣掉 rail,
    // 剩下的才是左栏该有的宽度
    applySidebarWidth(e.clientX - CHROME_U_REM * ROOT_FONT_BASE_PX * uiScale)
  }

  function endSashDrag(e: React.PointerEvent<HTMLDivElement>): void {
    if (!sashDraggingRef.current) return
    sashDraggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.classList.remove('is-sash-dragging')
    persistSidebarWidth()
  }

  function onSashDoubleClick(): void {
    applySidebarWidth(DEFAULT_SIDEBAR_WIDTH * uiScale)
    persistSidebarWidth()
  }

  // 键盘也能调(VSCode 同款):左右方向键微调,24px 一步
  function onSashKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    applySidebarWidth(sidebarWidthRef.current + (e.key === 'ArrowRight' ? 24 : -24))
    persistSidebarWidth()
  }

  return {
    uiScale,
    sidebarWidth,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    onSashPointerDown,
    onSashPointerMove,
    endSashDrag,
    onSashDoubleClick,
    onSashKeyDown
  }
}
