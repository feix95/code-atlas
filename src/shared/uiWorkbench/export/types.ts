// 导出的可插拔接口:源头只有 WorkbenchDocument 一份,每种目标格式是一个 ExportFormat(翻译器)。
// 新增平台(React Native、Godot 等)= 新写一个 ExportFormat 并登记进 formats.ts,源数据结构不动。
import type { ArtboardSize } from '../artboard.ts'
import type { SceneNode } from '../scene.ts'
import type { RectStyle } from '../styles.ts'

export interface WorkbenchDocument {
  artboard: ArtboardSize
  /** 绘制顺序:靠后的在上层 */
  nodes: readonly SceneNode[]
  /** 外观样式库(整包方案);节点经 styleId 引用,导出格式可发「定义+引用」而非只铺数值 */
  styles?: readonly RectStyle[]
}

export interface ExportFormat {
  id: string
  /** 导出菜单里的名字 */
  label: string
  /** 菜单悬停说明:这份文件拿来干什么 */
  tip: string
  /** 文件名(含扩展名) */
  fileName: string
  mimeType: string
  serialize: (doc: WorkbenchDocument) => string
}
