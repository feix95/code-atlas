import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 选中药丸的几何盒:相对所在容器的内边距盒左上角,单位同 CSS px */
interface SlideBox {
  top: number
  left: number
  width: number
  height: number
}

interface SlideState {
  box: SlideBox
  /** 选中项找得到才亮;收起/切空时淡出,但保留末位坐标 */
  visible: boolean
  /** 量过一次之后才开滑动:首次定位直接落位,不从 0,0 飞进来 */
  canSlide: boolean
  /** 长跳的第二程:先在原位淡出,计时器到点再把药丸挪到 pending 位淡入 */
  pending?: SlideBox
  /** 本次滑动的毫秒数:按距离缩放(近的快一点),不设就走 CSS 默认 */
  durMs?: number
}

interface SlideIndicatorProps {
  /** 选中项在父容器里的 CSS 选择器 */
  targetSelector: string
  /** 选中键:变化即重新量位,药丸滑向新位置 */
  activeKey: string | null
  /** 超过这个距离(px)就不滑了:长跳淡出淡入,不画飞行轨迹;不传则永远滑动 */
  fadeBeyondPx?: number
  className?: string
}

/** 淡出时长(ms),与 tokens.css 的 --dur-2 同值:长跳先等它演完再淡入 */
const FADE_OUT_MS = 170
/** 滑动基准时长(ms),与 tokens.css 的 --dur-2 同值 */
const SLIDE_MS = 150
/** 距离缩放的下限:再近也要够人眼跟上 */
const SLIDE_MIN_MS = 90

function measureTarget(container: HTMLElement, targetSelector: string): SlideBox | null {
  const target = container.querySelector<HTMLElement>(targetSelector)
  if (!target) return null
  const frame = container.getBoundingClientRect()
  const rect = target.getBoundingClientRect()
  return {
    top: rect.top - frame.top - container.clientTop + container.scrollTop,
    left: rect.left - frame.left - container.clientLeft + container.scrollLeft,
    width: rect.width,
    height: rect.height
  }
}

function isSameBox(a: SlideBox, b: SlideBox): boolean {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

function nextSlideState(
  prev: SlideState | null,
  box: SlideBox | null,
  fadeBeyondPx?: number
): SlideState | null {
  if (!box) {
    // 目标没了:有 pending 一并作废,免得计时器把药丸挪去一个已经没人选中的位置
    return prev ? { box: prev.box, visible: false, canSlide: false } : null
  }
  if (!prev) return { box, visible: true, canSlide: false }
  // 药丸本来藏着:直接在真实位置淡入,不从记忆里的旧位滑过来
  if (!prev.visible) return { box, visible: true, canSlide: false }
  if (isSameBox(prev.box, box)) return prev
  const dist = Math.hypot(box.top - prev.box.top, box.left - prev.box.left)
  if (fadeBeyondPx !== undefined && dist > fadeBeyondPx) {
    // 长跳:留在原位淡出,pending 记下新位,等淡出播完再挪过去淡入
    return { ...prev, visible: false, canSlide: false, pending: box }
  }
  return {
    box,
    visible: true,
    canSlide: true,
    durMs:
      fadeBeyondPx === undefined
        ? undefined
        : Math.round(Math.min(SLIDE_MS, Math.max(SLIDE_MIN_MS, (dist / fadeBeyondPx) * SLIDE_MS)))
  }
}

/**
 * 滑动选中底:一颗绝对定位的药丸,渲染在父容器内(父元素即量位容器),
 * 位置由量好的选中项几何写进 style;换选中时同一颗药丸平滑滑过去,不再瞬跳。
 * 传了 fadeBeyondPx 的列表(文件树)长跳改淡出淡入 —— 几百行跨度的滑动会像飞过去。
 * 父容器需 position: relative;选中项若要压在药丸之上,需自带 position 或是独立堆叠层。
 */
export function SlideIndicator({
  targetSelector,
  activeKey,
  fadeBeyondPx,
  className
}: SlideIndicatorProps): React.JSX.Element {
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const [state, setState] = useState<SlideState | null>(null)

  useLayoutEffect(() => {
    const container = indicatorRef.current?.parentElement
    if (!container) return
    const sync = (): void => {
      // 容器被 display:none 藏起来时量不出位置:清空账本,再显示时直接落位不做滑动
      if (container.getClientRects().length === 0) {
        setState(null)
        return
      }
      setState((prev) =>
        nextSlideState(prev, measureTarget(container, targetSelector), fadeBeyondPx)
      )
    }
    sync()
    const resizeObserver = new ResizeObserver(sync)
    resizeObserver.observe(container)
    const mutationObserver = new MutationObserver(sync)
    mutationObserver.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class']
    })
    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [targetSelector, activeKey, fadeBeyondPx])

  // 长跳的第二程:原位淡出播完后,把药丸挪到 pending 位淡入
  useEffect(() => {
    if (!state || state.visible || !state.pending) return
    const id = window.setTimeout(() => {
      setState((s) => (s?.pending ? { box: s.pending, visible: true, canSlide: false } : s))
    }, FADE_OUT_MS)
    return () => window.clearTimeout(id)
  }, [state])

  return (
    <span
      ref={indicatorRef}
      className={className ? `slide-ind ${className}` : 'slide-ind'}
      aria-hidden="true"
      data-visible={state?.visible ? 'true' : undefined}
      data-slide={state?.canSlide ? 'true' : undefined}
      style={
        state
          ? {
              top: state.box.top,
              left: state.box.left,
              width: state.box.width,
              height: state.box.height,
              transitionDuration: state.durMs !== undefined ? `${state.durMs}ms` : undefined
            }
          : undefined
      }
    />
  )
}
