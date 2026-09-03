import { useState } from 'react'
import type { ScanDirNode, ScanFileNode, ScanTreeNode } from '@shared/types'

interface TreeRowProps {
  node: ScanTreeNode
  depth: number
  selectedPath: string | null
  onSelectFile: (relPath: string, file: ScanFileNode) => void
  onSelectFolder: (relPath: string, name: string) => void
}

// 路径契约:relPath 由扫描器生成并存在节点上,界面只读取、绝不拼接
function TreeRow({ node, depth, selectedPath, onSelectFile, onSelectFolder }: TreeRowProps): React.JSX.Element {
  // 首层文件夹默认展开,再深的收起来,避免一上来铺满屏
  const [open, setOpen] = useState(depth < 1)

  if (node.type === 'file') {
    return (
      <button
        type="button"
        className={`tree-row is-file${selectedPath === node.relPath ? ' is-selected' : ''}`}
        style={{ paddingLeft: depth * 20 + 12 }}
        onClick={() => onSelectFile(node.relPath, node)}
      >
        <span className="tree-icon">📄</span>
        <span className="tree-name">{node.name}</span>
        {node.language?.source === 'content' && <span className="tree-lang">{node.language.name}</span>}
        {node.ext && <span className="tree-ext">{node.ext}</span>}
      </button>
    )
  }

  return (
    <div>
      <button
        type="button"
        className={`tree-row is-dir${selectedPath === node.relPath ? ' is-selected' : ''}`}
        style={{ paddingLeft: depth * 20 + 12 }}
        onClick={() => {
          setOpen(!open) // 展开/收起照旧;同时选中它,右侧出文件夹讲解卡
          onSelectFolder(node.relPath, node.name)
        }}
      >
        <span className="tree-icon">{open ? '📂' : '📁'}</span>
        <span className="tree-name">{node.name}</span>
        {node.truncated && <span className="tree-badge">不完整</span>}
        <span className="tree-arrow">{open ? '▾' : '▸'}</span>
      </button>
      {open &&
        node.children.map((child) => (
          <TreeRow
            key={child.name}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            onSelectFolder={onSelectFolder}
          />
        ))}
    </div>
  )
}

interface FileTreeProps {
  root: ScanDirNode
  selectedPath: string | null
  onSelectFile: (relPath: string, file: ScanFileNode) => void
  onSelectFolder: (relPath: string, name: string) => void
}

export function FileTree({ root, selectedPath, onSelectFile, onSelectFolder }: FileTreeProps): React.JSX.Element {
  return (
    <div className="tree">
      <TreeRow node={root} depth={0} selectedPath={selectedPath} onSelectFile={onSelectFile} onSelectFolder={onSelectFolder} />
    </div>
  )
}
