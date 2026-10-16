// 属性面板顶栏的「导出」按钮:点开全局通用菜单,列出 EXPORT_FORMATS 登记的全部格式。
// 导出对象 = 当前页的每个可见顶层画板(一个画板一份文件,多个画板时文件名带画板名);
// 页面画布底色与散放在页面上的对象不导出。选中即序列化并经浏览器下载落地(Electron 默认弹系统另存对话框)。
import { EXPORT_FORMATS } from '@shared/uiWorkbench/export/formats'
import type { FrameExportTarget } from '@shared/uiWorkbench/export/frameDocument'
import { openContextMenu } from '../contextMenuStore'
import { downloadText } from '../../uiWorkbench/download'

/** 多画板时给文件名插入画板名:design.html + 画板 1 → design-画板 1.html */
function targetFileName(fileName: string, targetName: string, isMulti: boolean): string {
  if (!isMulti) return fileName
  const dot = fileName.lastIndexOf('.')
  const safe = targetName.replace(/[\\/:*?"<>|]/g, '_')
  return dot < 0 ? `${fileName}-${safe}` : `${fileName.slice(0, dot)}-${safe}${fileName.slice(dot)}`
}

export function ExportMenu({
  targets
}: {
  targets: readonly FrameExportTarget[]
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="cfg-btn is-ghost uwb-export"
      aria-label="导出"
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
            run: () => {
              if (targets.length === 0) return '当前页还没有画板,先按 F 拖出一个'
              for (const t of targets) {
                downloadText(
                  targetFileName(f.fileName, t.name, targets.length > 1),
                  f.serialize(t.doc),
                  f.mimeType,
                  target.ownerDocument
                )
              }
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
