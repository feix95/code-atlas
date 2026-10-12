// 属性面板顶栏的「导出」按钮:点开全局通用菜单,列出 EXPORT_FORMATS 登记的全部格式。
// 选中即序列化并经浏览器下载落地(Electron 默认弹系统另存对话框)。
import { EXPORT_FORMATS } from '@shared/uiWorkbench/export/formats'
import type { WorkbenchDocument } from '@shared/uiWorkbench/export/types'
import { openContextMenu } from '../contextMenuStore'
import { downloadText } from '../../uiWorkbench/download'

export function ExportMenu({ doc }: { doc: WorkbenchDocument }): React.JSX.Element {
  return (
    <button
      type="button"
      className="cfg-btn is-ghost uwb-export"
      aria-label="导出"
      data-tip="导出设计数值或代码"
      onClick={(e) => {
        const target = e.currentTarget
        const rect = target.getBoundingClientRect()
        openContextMenu({
          x: rect.left,
          y: rect.bottom + 4,
          doc: target.ownerDocument,
          compact: true,
          items: EXPORT_FORMATS.map((f) => ({
            label: f.label,
            tip: f.tip,
            run: () => {
              downloadText(f.fileName, f.serialize(doc), f.mimeType, target.ownerDocument)
              return '已开始导出'
            }
          }))
        })
      }}
    >
      导出
    </button>
  )
}
