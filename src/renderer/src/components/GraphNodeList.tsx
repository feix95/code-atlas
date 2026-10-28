// 关系图谱页签的读屏与导航部件:面包屑、节点按钮清单(视觉隐藏,键盘与读屏可达)。
import type { LevelNode } from '@shared/graphView'
import type { GraphNav } from '../graph/useGraphNav'

export function Crumbs({ rootName, nav }: { rootName: string; nav: GraphNav }): React.JSX.Element {
  const parts = nav.dirRel === '' ? [] : nav.dirRel.split('/')
  const labels = [rootName, ...parts]
  return (
    <nav className="graph-crumbs" aria-label="当前位置">
      {labels.map((label, i) => {
        const last = i === labels.length - 1
        return (
          <span key={i} className="graph-crumb">
            {i > 0 && (
              <span className="graph-crumb-sep" aria-hidden="true">
                /
              </span>
            )}
            <button
              type="button"
              disabled={last}
              aria-current={last ? 'location' : undefined}
              onClick={() => void nav.navigate(parts.slice(0, i).join('/'))}
            >
              {label}
            </button>
          </span>
        )
      })}
    </nav>
  )
}

function describeBase(d: LevelNode): string {
  switch (d.kind) {
    case 'folder':
      return d.lazy
        ? `文件夹 ${d.label}(尚未读取)`
        : `文件夹 ${d.label}(${d.descendantFiles} 个文件)`
    case 'file':
      return `文件 ${d.label}(${d.degree} 条引用)`
    case 'external':
      return `当前文件夹以外 ${d.id}`
    case 'overflow':
      return d.label
  }
}

/** 读屏描述:基本信息 + 所属模块(有划分数据时) */
function describeNode(d: LevelNode, moduleName: string | null): string {
  return moduleName ? `${describeBase(d)},属于模块 ${moduleName}` : describeBase(d)
}

/** 画布节点的键盘 / 读屏入口:视觉隐藏的按钮清单,Tab 切换焦点即在画布上高亮对应节点 */
export function NodeList({
  nodes,
  moduleNameOf,
  onActivate,
  onFocusNode
}: {
  nodes: LevelNode[]
  moduleNameOf: (id: string) => string | null
  onActivate: (d: LevelNode) => void
  onFocusNode: (id: string | null) => void
}): React.JSX.Element {
  return (
    <ul className="graph-a11y" aria-label="当前文件夹的节点">
      {nodes.map((d) => (
        <li key={d.id}>
          <button
            type="button"
            disabled={d.kind === 'overflow'}
            onClick={() => onActivate(d)}
            onFocus={() => onFocusNode(d.id)}
            onBlur={() => onFocusNode(null)}
          >
            {describeNode(d, moduleNameOf(d.id))}
          </button>
        </li>
      ))}
    </ul>
  )
}
