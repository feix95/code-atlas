// Ctrl+滚轮的收口层(缩放跟签走这锤):一张页签一块层,滚轮在这层统一记账,
// 缩放档位按 tab.id 查户口(tabZoom.ts)。三种走法按品类分:
//  - preview/peek:层只透 --doc-zoom,字号乘法 —— 保住虚拟滚动的 computedStyle 账;
//  - overview/chat/settings:CSS zoom 整页缩 —— 布局与滚动条一起老实;
//  - graph/uiframe:层不插手 —— 图谱有自己的画布缩放,UI 框架是带坐标账的工作台。
import { useEffect, useRef } from 'react'
import type { PaneKind } from '../paneKinds'
import type { PaneTab } from '../paneTabs'
import { DOC_ZOOM_STEP } from '@shared/docZoom'
import { getTabZoom, setTabZoom, useTabZoom, WHEEL_ACC_TTL_MS, WHEEL_NOTCH } from '../tabZoom'

/** 层放手的品类:滚轮缩放归它们自己管(图谱画布缩放/工作台坐标账) */
const OWN_ZOOM_KINDS = new Set<PaneKind>(['graph', 'uiframe'])
/** CSS zoom 整页缩的品类(文件签走字号乘法,不在这份名单) */
const CSS_ZOOM_KINDS = new Set<PaneKind>(['overview', 'chat', 'settings'])

export function TabZoomLayer({
  tab,
  children
}: {
  tab: PaneTab
  children: React.ReactNode
}): React.JSX.Element {
  const layerRef = useRef<HTMLDivElement>(null)
  const zoom = useTabZoom(tab.id)
  const wheelable = !OWN_ZOOM_KINDS.has(tab.kind)

  // Ctrl+滚轮在这层统一记账:碎步攒成整档才翻、隔久清账,触控板捏合白捡。
  // 原生监听 + passive:false —— React 的 onWheel 是被动户口,preventDefault 落不了地;
  // 监听器挂层元素本身,天然 realm-safe(子窗签的滚轮在子窗文档里转)。
  useEffect(() => {
    const el = layerRef.current
    if (!el || !wheelable) return
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
      setTabZoom(tab.id, getTabZoom(tab.id) - steps * DOC_ZOOM_STEP) // 向下滚 = 缩小
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [tab.id, wheelable])

  return (
    <div
      ref={layerRef}
      className="tab-zoom-layer"
      style={
        {
          '--doc-zoom': zoom,
          // zoom:1 也照写会凭空多一层渲染上下文,100% 时就别落这个属性
          ...(CSS_ZOOM_KINDS.has(tab.kind) && zoom !== 1 ? { zoom } : {})
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  )
}
