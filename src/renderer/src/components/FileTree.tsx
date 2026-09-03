import { useState } from 'react'
import type { ScanDirNode, ScanTreeNode } from '@shared/types'

function TreeRow({ node, depth }: { node: ScanTreeNode; depth: number }): React.JSX.Element {
  // 首层文件夹默认展开,再深的收起来,避免一上来铺满屏
  const [open, setOpen] = useState(depth < 1)

  if (node.type === 'file') {
    return (
      <div className="tree-row is-file" style={{ paddingLeft: depth * 20 + 12 }}>
        <span className="tree-icon">📄</span>
        <span className="tree-name">{node.name}</span>
        {node.language?.source === 'content' && (
          <span className="tree-lang">{node.language.name}</span>
        )}
        {node.ext && <span className="tree-ext">{node.ext}</span>}
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        className="tree-row is-dir"
        style={{ paddingLeft: depth * 20 + 12 }}
        onClick={() => setOpen(!open)}
      >
        <span className="tree-icon">{open ? '📂' : '📁'}</span>
        <span className="tree-name">{node.name}</span>
        {node.truncated && <span className="tree-badge">不完整</span>}
        <span className="tree-arrow">{open ? '▾' : '▸'}</span>
      </button>
      {open && node.children.map((child) => <TreeRow key={child.name} node={child} depth={depth + 1} />)}
    </div>
  )
}

export function FileTree({ root }: { root: ScanDirNode }): React.JSX.Element {
  return (
    <div className="tree">
      <TreeRow node={root} depth={0} />
    </div>
  )
}
