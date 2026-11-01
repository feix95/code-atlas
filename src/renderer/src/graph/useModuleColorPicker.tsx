// 模块改色浮层的打开状态:右键「更改模块颜色」时取当前色,改色按项目存在本机(moduleColorStore),
// 同一模块在图上每一层、侧栏里都跟着变。
import { useCallback, useState } from 'react'
import { ModuleColorPicker, type PickerTarget } from '../components/ModuleColorPicker'
import { readGraphColors } from './drawGraph'
import { moduleColorOf } from './drawModules'
import { isHexColor, type ColorOverrides } from './colorPrefs'
import { setModuleColor } from './moduleColorStore'
import { moduleDisplayName, type ModuleOverlay } from './moduleOverlay'
import type { ModuleNames } from './moduleNames'
/** 任意 CSS 颜色(含 hsl)换成 #rrggbb:交给 Canvas 解析,解析不了回落中灰 */
function toHex(color: string, doc: Document): string {
  const ctx = doc.createElement('canvas').getContext('2d')
  if (!ctx) return '#888888'
  ctx.fillStyle = '#888888'
  ctx.fillStyle = color
  return isHexColor(ctx.fillStyle) ? ctx.fillStyle : '#888888'
}

interface PickerDeps {
  root: string
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  overlay: ModuleOverlay
  overrides: ColorOverrides
  /** 当前语种的模块显示名 */
  names: ModuleNames
}

/** 浮层的打开状态;open 的坐标是右键菜单给的屏幕坐标 */
export function useModuleColorPicker({ root, canvasRef, overlay, overrides, names }: PickerDeps): {
  open: (moduleId: string, clientX: number, clientY: number) => void
  element: React.JSX.Element | null
} {
  const [target, setTarget] = useState<PickerTarget | null>(null)
  const open = useCallback(
    (moduleId: string, clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      const info = overlay.byId.get(moduleId)
      if (!canvas || !info) return
      const rect = canvas.getBoundingClientRect()
      const colors = readGraphColors(canvas).modules
      const color = moduleColorOf({ overlay, overrides }, colors, moduleId)
      setTarget({
        id: moduleId,
        name: names.get(moduleId) ?? moduleDisplayName(info),
        x: clientX - rect.left,
        y: clientY - rect.top,
        current: toHex(color, canvas.ownerDocument),
        isCustom: overrides.has(moduleId)
      })
    },
    [canvasRef, overlay, overrides, names]
  )
  const close = useCallback(() => setTarget(null), [])
  const pick = useCallback(
    (color: string | null, keepOpen: boolean) => {
      if (!target) return
      setModuleColor(root, target.id, color)
      // 点预设或恢复默认就收起;拖系统取色器时浮层留着,边拖边看图上的效果
      if (!keepOpen || color === null) setTarget(null)
      else setTarget({ ...target, current: color, isCustom: true })
    },
    [root, target]
  )
  const element = target ? (
    <ModuleColorPicker target={target} onPick={pick} onClose={close} />
  ) : null
  return { open, element }
}
