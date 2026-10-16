// 画板 → 导出文档:一个画板 = 一份产物。取画板自己的尺寸与填充,后代节点平移到以画板左上角为原点,
// 隐藏的(含被隐藏的容器里的)不导出。画布渲染同样走这里,画布所见即导出所得。
// 画板里再嵌套的画板按普通盒子导出(这一版不做嵌套裁切)。
import type { LineStyle } from '../lineStyles.ts'
import { applyNodeAction, translatePatch, visibleNodes, type SceneNode } from '../scene.ts'
import type { RectStyle } from '../styles.ts'
import { childrenOf, withDescendants } from '../tree.ts'
import type { WorkbenchDocument } from './types.ts'

export interface StyleLibraries {
  styles?: readonly RectStyle[]
  lineStyles?: readonly LineStyle[]
}

function shifted(node: SceneNode, dx: number, dy: number): SceneNode {
  return applyNodeAction([node], {
    type: 'update',
    id: node.id,
    patch: translatePatch(node, dx, dy)
  })[0]
}

export interface FrameExportTarget {
  frameId: string
  name: string
  doc: WorkbenchDocument
}

/** 一页的导出清单:每个可见的顶层画板一份(页面画布底色与散放对象不导出) */
export function pageExportTargets(
  nodes: readonly SceneNode[],
  libraries: StyleLibraries = {}
): FrameExportTarget[] {
  return childrenOf(visibleNodes(nodes), null).flatMap((node) => {
    const doc = node.type === 'frame' ? frameDocument(nodes, node.id, libraries) : null
    return doc ? [{ frameId: node.id, name: node.name, doc }] : []
  })
}

/** 画板不存在、被隐藏时返回 null */
export function frameDocument(
  nodes: readonly SceneNode[],
  frameId: string,
  libraries: StyleLibraries = {}
): WorkbenchDocument | null {
  const visible = visibleNodes(nodes)
  const frame = visible.find((n) => n.id === frameId)
  if (frame?.type !== 'frame') return null
  const inside = withDescendants(visible, [frameId]).filter((n) => n.id !== frameId)
  return {
    artboard: { width: frame.width, height: frame.height },
    artboardFill: frame.fill,
    nodes: inside.map((n) => shifted(n, -frame.x, -frame.y)),
    ...libraries
  }
}
