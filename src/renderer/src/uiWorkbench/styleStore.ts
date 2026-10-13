// 矩形外观样式仓库(渲染端):存本机,关掉重开不丢;节点经 styleId 挂接(活链接),
// 改定义/删定义的回写走 docActions。读写与订阅由 persistentList 工厂统一承担。
import {
  normalizeStyleName,
  removeStylePreset,
  sanitizeStylePresets,
  saveStylePreset,
  type RectStyle,
  type StyleAppearance
} from '@shared/uiWorkbench/styles'
import { createPersistentList } from './persistentList'

const store = createPersistentList<RectStyle>(
  'atlas.uiWorkbench.styles',
  '外观样式',
  sanitizeStylePresets
)

export const useStyles = store.use as () => RectStyle[]
export const getStyles = store.get as () => RectStyle[]

export const styleActions = {
  /** 存方案:同名覆盖(沿用原 id——挂接节点靠 id 认,不会被换名弄丢);
   *  返回 { id, overwrote }:overwrote 为 true 时调用方应把新定义回写到所有挂接节点 */
  save(rawName: string, appearance: StyleAppearance): { id: string; overwrote: boolean } {
    const styles = getStyles()
    const r = saveStylePreset(styles, {
      id: crypto.randomUUID(),
      name: normalizeStyleName(rawName, styles.length + 1),
      fill: appearance.fill,
      stroke: appearance.stroke,
      radii: appearance.radii
    })
    store.set(r.list)
    return { id: r.id, overwrote: r.overwrote }
  },
  remove(id: string): void {
    store.set(removeStylePreset(getStyles(), id))
  }
}
