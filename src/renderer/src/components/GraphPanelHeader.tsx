// 节点详情两态(画布浮窗、左栏停靠)共用的标头:类型小字 + 名字/计数 + 右上角控件。
// 控件压在类型小字那一行,标题行独占整宽;停靠钮有没有都只向左边长,不挤动名字与计数。
import type { LevelNode } from '@shared/graphView'

const KIND_LABEL: Record<LevelNode['kind'], string> = {
  file: '文件',
  folder: '文件夹',
  external: '当前文件夹以外',
  overflow: '收起的项'
}

/** 名字右边那一列:文件夹给文件数,收起的项给剩余数量;文件不重复正文里的引用数 */
function headingMeta(node: LevelNode): string | null {
  if (node.kind === 'folder') return node.lazy ? '尚未读取' : `共 ${node.descendantFiles} 个文件`
  if (node.kind === 'overflow') return `其余 ${node.hiddenCount ?? 0} 项`
  return null
}

export function GraphPanelHeader({
  node,
  grip,
  gripLabel,
  controls
}: {
  node: LevelNode
  /** 浮窗态传入整套拖动把手;停靠态由外壳的标题条接管拖出,这里不传 */
  grip?: React.HTMLAttributes<HTMLElement>
  gripLabel?: string
  /** 右上角控件(停靠、放回、关闭) */
  controls: React.ReactNode
}): React.JSX.Element {
  const meta = headingMeta(node)
  const heading = (
    <>
      <p className="graph-panel-kind">{KIND_LABEL[node.kind]}</p>
      <div className="graph-panel-title-row">
        <h2 className="graph-panel-title">{node.label}</h2>
        {meta && <span className="graph-panel-meta">{meta}</span>}
      </div>
    </>
  )
  return (
    <header className="graph-panel-head">
      {grip ? (
        <div
          className="graph-panel-drag"
          role="button"
          tabIndex={0}
          aria-label={gripLabel}
          {...grip}
        >
          {heading}
        </div>
      ) : (
        <div className="graph-panel-drag">{heading}</div>
      )}
      <div className="graph-panel-controls">{controls}</div>
    </header>
  )
}
