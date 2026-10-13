// 直线面板「样式」分区的业务逻辑(套用 / 存为 / 删除),规则同矩形样式:
// 套用 = 写入定义值并挂 styleId(一次 dispatch = 一步撤销);手动改外观 = 静默脱钩;
// 同名保存 = 覆盖定义并回写所有挂接的线(活链接);删除定义 = 挂着的线保留数值、统一脱钩。
// 界面层(LinePanel)只负责渲染,不碰仓库与批次。
import type { LineNode, LinePatch } from '@shared/uiWorkbench/line'
import { lineAppearanceOf, linkedLineStyleId, type LineStyle } from '@shared/uiWorkbench/lineStyles'
import { docActions, getDocState } from './documentStore'
import { lineStyleActions, useLineStyles } from './lineStyleStore'
import { newLineDefaultsActions } from './newLineDefaultsStore'

export interface LineStyleBindings {
  styles: readonly LineStyle[]
  /** 当前线挂着的样式 id;无样式或悬空为 '' */
  linkedId: string
  apply: (styleId: string) => void
  save: (rawName: string) => void
  remove: () => void
}

/** node:面板对应的线(默认外观模式下是不进文档的预览节点);patch:改它的落点 */
export function useLineStyleActions(
  node: LineNode,
  patch: (p: LinePatch) => void,
  isDefaults: boolean
): LineStyleBindings {
  const styles = useLineStyles()
  const linkedId = linkedLineStyleId(node, styles)

  function apply(styleId: string): void {
    if (styleId === '') {
      patch({ styleId: null })
      newLineDefaultsActions.rememberStyle(null)
      return
    }
    const style = styles.find((s) => s.id === styleId)
    if (!style) return
    patch({ ...lineAppearanceOf(style), styleId: style.id })
    newLineDefaultsActions.rememberStyle(style.id, style)
  }

  function save(rawName: string): void {
    const appearance = lineAppearanceOf(node)
    const { id, overwrote } = lineStyleActions.save(rawName, appearance)
    docActions.beginBatch()
    try {
      if (overwrote) {
        for (const n of getDocState().nodes) {
          if (n.type === 'line' && n.styleId === id) {
            docActions.dispatch({
              type: 'update',
              id: n.id,
              patch: { ...appearance, styleId: id }
            })
          }
        }
      }
      if (node.styleId !== id) patch({ styleId: id })
      newLineDefaultsActions.rememberStyle(id, appearance)
    } finally {
      docActions.endBatch()
    }
  }

  function remove(): void {
    if (!linkedId) return
    lineStyleActions.remove(linkedId)
    docActions.beginBatch()
    try {
      for (const n of getDocState().nodes) {
        if (n.type === 'line' && n.styleId === linkedId) {
          docActions.dispatch({ type: 'update', id: n.id, patch: { styleId: null } })
        }
      }
    } finally {
      docActions.endBatch()
    }
    // 默认外观节点不在文档里,上面的循环扫不到它
    if (isDefaults) patch({ styleId: null })
  }

  return { styles, linkedId, apply, save, remove }
}
