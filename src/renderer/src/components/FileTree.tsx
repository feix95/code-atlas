import { useState } from 'react'
import type { ScanDirNode, ScanFileNode, ScanTreeNode } from '@shared/types'

interface TreeRowProps {
  node: ScanTreeNode
  depth: number
  selectedPath: string | null
  /** 正在点开探测的目录 relPath(分级扫描转圈提示) */
  expandingPath: string | null
  onSelectFile: (relPath: string, file: ScanFileNode) => void
  onSelectFolder: (relPath: string, name: string) => void
  onExpandLazy: (relPath: string) => void
}

// 路径契约:relPath 由扫描器生成并存在节点上,界面只读取、绝不拼接
function TreeRow({ node, depth, selectedPath, expandingPath, onSelectFile, onSelectFolder, onExpandLazy }: TreeRowProps): React.JSX.Element {
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
        {node.summary && (
          <span className="tree-summary" title={node.summary.text}>
            {node.summary.emoji} {node.summary.text}
          </span>
        )}
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
          // 分级扫描:还没探的目录,点开先探这一层;探过的照旧展开/收起
          if (node.lazy) {
            onExpandLazy(node.relPath)
          } else {
            setOpen(!open)
          }
          onSelectFolder(node.relPath, node.name)
        }}
      >
        <span className="tree-icon">{!node.lazy && open ? '📂' : '📁'}</span>
        <span className="tree-name">{node.name}</span>
        {node.summary && (
          <span className="tree-summary" title={node.summary.text}>
            {node.summary.emoji} {node.summary.text}
          </span>
        )}
        {node.lazy && (
          <span className="tree-badge">
            {expandingPath === node.relPath ? '⏳ 正在探……' : '点开探一探'}
          </span>
        )}
        {node.truncated && !node.lazy && <span className="tree-badge">不完整</span>}
        {!node.lazy && <span className="tree-arrow">{open ? '▾' : '▸'}</span>}
      </button>
      {open &&
        node.children.map((child) => (
          <TreeRow
            key={child.name}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            expandingPath={expandingPath}
            onSelectFile={onSelectFile}
            onSelectFolder={onSelectFolder}
            onExpandLazy={onExpandLazy}
          />
        ))}
    </div>
  )
}

interface FileTreeProps {
  root: ScanDirNode
  selectedPath: string | null
  expandingPath: string | null
  onSelectFile: (relPath: string, file: ScanFileNode) => void
  onSelectFolder: (relPath: string, name: string) => void
  onExpandLazy: (relPath: string) => void
}

export function FileTree({ root, selectedPath, expandingPath, onSelectFile, onSelectFolder, onExpandLazy }: FileTreeProps): React.JSX.Element {
  return (
    <div className="tree">
      <TreeRow
        node={root}
        depth={0}
        selectedPath={selectedPath}
        expandingPath={expandingPath}
        onSelectFile={onSelectFile}
        onSelectFolder={onSelectFolder}
        onExpandLazy={onExpandLazy}
      />
    </div>
  )
}
