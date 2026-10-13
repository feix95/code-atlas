// 直线外观样式仓库(渲染端):规则与矩形样式库(styleStore)一致,各存各的——
// 两种工具的外观字段不同,样式库按工具分开,选中哪种对象就只列哪种样式。
import {
  sanitizeLineStyles,
  type LineAppearance,
  type LineStyle
} from '@shared/uiWorkbench/lineStyles'
import { normalizeStyleName, removeStylePreset, saveStylePreset } from '@shared/uiWorkbench/styles'
import { createPersistentList } from './persistentList'

const store = createPersistentList<LineStyle>(
  'atlas.uiWorkbench.lineStyles',
  '直线样式',
  sanitizeLineStyles
)

export const useLineStyles = store.use as () => LineStyle[]
export const getLineStyles = store.get as () => LineStyle[]

export const lineStyleActions = {
  /** 存方案:同名覆盖沿用原 id;overwrote 为 true 时调用方应把新定义回写到所有挂接的线 */
  save(rawName: string, appearance: LineAppearance): { id: string; overwrote: boolean } {
    const styles = getLineStyles()
    const r = saveStylePreset(styles, {
      id: crypto.randomUUID(),
      name: normalizeStyleName(rawName, styles.length + 1),
      stroke: { ...appearance.stroke },
      cap: appearance.cap
    })
    store.set(r.list)
    return { id: r.id, overwrote: r.overwrote }
  },
  remove(id: string): void {
    store.set(removeStylePreset(getLineStyles(), id))
  }
}
