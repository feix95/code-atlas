// 画板 iframe 内的设计文档渲染:<style> 注入 CSS 适配器 artboardCss 的原样输出,
// 结构与导出 HTML 一致(节点 div 包在 .artboard 里)—— 画布所见即导出所得,不另写一套渲染。
// iframe 本身不接收指针(pointer-events: none),交互全部走视口坐标换算。
import { createPortal } from 'react-dom'
import { artboardCss, ARTBOARD_CLASS } from '@shared/uiWorkbench/export/cssAdapter'
import type { WorkbenchDocument } from '@shared/uiWorkbench/export/types'

export function ArtboardNodes({
  body,
  doc
}: {
  body: HTMLBodyElement
  doc: WorkbenchDocument
}): React.JSX.Element {
  return createPortal(
    <>
      <style>{`body { margin: 0; }\n${artboardCss(doc)}`}</style>
      <div className={ARTBOARD_CLASS}>
        {doc.nodes.map((n) => (
          <div key={n.id} className={n.id} />
        ))}
      </div>
    </>,
    body
  )
}
