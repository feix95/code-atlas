// 模块改色浮层:右键「更改模块颜色」后在鼠标处打开。预设色、系统取色器、恢复默认;Esc 或点浮层外关闭。
import { useLayoutEffect, useEffect, useRef, useState } from 'react'

/** 预设色:亮暗两种背景上都看得清的中等明度色 */
const PRESETS = [
  '#e5484d',
  '#f76b15',
  '#d9a400',
  '#46a758',
  '#12a594',
  '#0090ff',
  '#3e63dd',
  '#8e4ec6',
  '#d6409f',
  '#ad7f58',
  '#6b7785',
  '#2b9a66'
]

export interface PickerTarget {
  id: string
  name: string
  /** 浮层坐标:默认相对画布;fixed 时是视口坐标 */
  x: number
  y: number
  /** 当前颜色(#rrggbb,供取色器回显) */
  current: string
  isCustom: boolean
}

export function ModuleColorPicker({
  target,
  fixed,
  onPick,
  onClose
}: {
  target: PickerTarget
  /** 视口坐标定位:从侧栏等画布外的位置打开时用 */
  fixed?: boolean
  /** keepOpen:系统取色器拖动中,浮层留着边拖边看效果 */
  onPick: (color: string | null, keepOpen: boolean) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: target.x, top: target.y })
  // 贴着鼠标打开;超出画布或视口时往回收
  useLayoutEffect(() => {
    const el = ref.current
    const box = fixed ? null : el?.offsetParent
    if (!el) return
    const width = box?.clientWidth ?? el.ownerDocument.defaultView?.innerWidth ?? 0
    const height = box?.clientHeight ?? el.ownerDocument.defaultView?.innerHeight ?? 0
    const left = Math.max(0, Math.min(target.x, width - el.offsetWidth))
    const top = Math.max(0, Math.min(target.y, height - el.offsetHeight))
    setPos({ left, top })
  }, [fixed, target.x, target.y])
  useEffect(() => {
    const doc = ref.current?.ownerDocument ?? document
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    doc.addEventListener('pointerdown', onDown, true)
    doc.addEventListener('keydown', onKey)
    return () => {
      doc.removeEventListener('pointerdown', onDown, true)
      doc.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      className={`graph-color-picker${fixed ? ' graph-color-picker-fixed' : ''}`}
      role="dialog"
      aria-label={`更改「${target.name}」的颜色`}
      style={pos}
    >
      <p className="graph-color-title">{target.name}</p>
      <div className="graph-color-grid">
        {PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            className="graph-color-swatch"
            style={{ background: c }}
            aria-label={`颜色 ${c}`}
            aria-pressed={c === target.current}
            onClick={() => onPick(c, false)}
          />
        ))}
      </div>
      <div className="graph-color-row">
        <label className="graph-color-custom">
          <input
            type="color"
            value={target.current}
            onChange={(e) => onPick(e.target.value, true)}
          />
          自定义
        </label>
        <button
          type="button"
          className="graph-panel-btn"
          disabled={!target.isCustom}
          onClick={() => onPick(null, false)}
        >
          恢复默认
        </button>
      </div>
    </div>
  )
}
