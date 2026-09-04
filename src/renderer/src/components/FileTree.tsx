import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScanDirNode, ScanFileNode, ScanTreeNode } from '@shared/types'

interface TreeRowProps {
  node: ScanTreeNode
  depth: number
  selectedPath: string | null
  /** 正在点开探测的目录 relPath(分级扫描转圈提示) */
  expandingPath: string | null
  /** 搜索过滤词;空串 = 不过滤(过滤时全树按名字匹配,目录自动全展开) */
  filter: string
  onSelectFile: (relPath: string, file: ScanFileNode) => void
  onSelectFolder: (node: ScanDirNode) => void
  onExpandLazy: (relPath: string) => void
}

// 路径契约:relPath 由扫描器生成并存在节点上,界面只读取、绝不拼接
function TreeRow({ node, depth, selectedPath, expandingPath, filter, onSelectFile, onSelectFolder, onExpandLazy }: TreeRowProps): React.JSX.Element | null {
  // 首层文件夹默认展开,再深的收起来,避免一上来铺满屏
  const [open, setOpen] = useState(depth < 1)
  // 分级扫描:点箭头把还没探的目录探进来;探完(节点从 lazy 变实)自动张开给孩子看
  const wasLazy = useRef(false)
  useEffect(() => {
    const lazy = node.type === 'directory' ? (node.lazy ?? false) : false
    if (wasLazy.current && !lazy) setOpen(true)
    wasLazy.current = lazy
  }, [node])

  // 过滤态下目录一律摊开,不看你之前的展开手癖
  const expanded = filter !== '' || open

  if (node.type === 'file') {
    return (
      <div className={`tree-row is-file${selectedPath === node.relPath ? ' is-selected' : ''}`} style={{ paddingLeft: depth * 18 }}>
        <span className="tree-caret" aria-hidden="true" />
        <button
          type="button"
          className="tree-main"
          onClick={() => onSelectFile(node.relPath, node)}
          title={node.summary?.text}
        >
          <span className="tree-icon" aria-hidden="true">
            ▤
          </span>
          <span className="tree-name">{node.name}</span>
          {node.summary && <span className="tree-summary">{node.summary.text}</span>}
          {node.ext && <span className="tree-tag">{node.ext.slice(1).toUpperCase()}</span>}
        </button>
      </div>
    )
  }

  const dir = node

  // 箭头只管展开/收起;没探过的目录,箭头才是触发扫描的唯一入口(点名字不扫)
  function toggleExpand(): void {
    if (dir.lazy) {
      if (expandingPath !== dir.relPath) onExpandLazy(dir.relPath)
      return
    }
    setOpen(!open)
  }

  // 键盘方向键:右箭头展开(没探的顺势扫描),左箭头收起 —— 不摸鼠标也能逛树
  function onRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'ArrowRight' && (!expanded || dir.lazy)) {
      e.preventDefault()
      toggleExpand()
    } else if (e.key === 'ArrowLeft' && expanded && !dir.lazy) {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="tree-branch">
      <div
        className={`tree-row is-dir${selectedPath === dir.relPath ? ' is-selected' : ''}`}
        style={{ paddingLeft: depth * 18 }}
        onKeyDown={onRowKeyDown}
      >
        <button
          type="button"
          className={`tree-caret${dir.lazy ? ' is-lazy' : ''}`}
          aria-label={dir.lazy ? `展开并扫描 ${dir.name}` : expanded ? `收起 ${dir.name}` : `展开 ${dir.name}`}
          aria-expanded={dir.lazy ? undefined : expanded}
          onClick={toggleExpand}
        >
          {expandingPath === dir.relPath ? <span className="tree-spin" aria-hidden="true" /> : <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>}
        </button>
        <button type="button" className="tree-main" onClick={() => onSelectFolder(dir)} title={dir.summary?.text}>
          <span className="tree-icon" aria-hidden="true">
            ▣
          </span>
          <span className="tree-name">{dir.name}</span>
          {dir.summary && <span className="tree-summary">{dir.summary.text}</span>}
          {/* 未扫描/不完整都是琥珀色:是「留个心眼」不是「出事了」,红色只留给真失败 */}
          {dir.lazy && <span className="tree-badge is-warn">未扫描</span>}
          {dir.truncated && !dir.lazy && <span className="tree-badge is-warn">不完整</span>}
          {!dir.lazy && dir.children.length > 0 && <span className="tree-count">{dir.children.length}</span>}
        </button>
      </div>
      {expanded &&
        dir.children.map((child) => (
          <TreeRow
            key={child.name}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            expandingPath={expandingPath}
            filter={filter}
            onSelectFile={onSelectFile}
            onSelectFolder={onSelectFolder}
            onExpandLazy={onExpandLazy}
          />
        ))}
    </div>
  )
}

/** 过滤:名字含关键字(不分大小写)的文件留下;目录自己命中或还有命中的后代就留下 */
function filterTree(node: ScanDirNode, q: string): ScanDirNode | null {
  const selfMatch = node.name.toLowerCase().includes(q)
  if (node.lazy) return selfMatch ? node : null // 没探开的目录无从看内容,只按名字匹配
  const children: ScanTreeNode[] = []
  for (const child of node.children) {
    if (child.type === 'file') {
      if (child.name.toLowerCase().includes(q)) children.push(child)
    } else {
      const kept = filterTree(child, q)
      if (kept) children.push(kept)
    }
  }
  if (!selfMatch && children.length === 0) return null
  return { ...node, children }
}

interface FileTreeProps {
  root: ScanDirNode
  selectedPath: string | null
  expandingPath: string | null
  onSelectFile: (relPath: string, file: ScanFileNode) => void
  onSelectFolder: (node: ScanDirNode) => void
  onExpandLazy: (relPath: string) => void
}

export function FileTree({ root, selectedPath, expandingPath, onSelectFile, onSelectFolder, onExpandLazy }: FileTreeProps): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()

  const shown = useMemo(() => {
    if (q === '') return root
    return filterTree(root, q)
  }, [root, q])

  return (
    <>
      <div className="sidebar-top">
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={filter}
            placeholder="搜索已加载的文件"
            aria-label="搜索文件(在已扫描的范围里找)"
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
      </div>
      <div className="tree-scroll">
        <div className="tree">
          {shown ? (
            <TreeRow
              node={shown}
              depth={0}
              selectedPath={selectedPath}
              expandingPath={expandingPath}
              filter={q}
              onSelectFile={onSelectFile}
              onSelectFolder={onSelectFolder}
              onExpandLazy={onExpandLazy}
            />
          ) : (
            <div className="empty-state">
              <p className="empty-title">没找到叫「{filter.trim()}」的文件</p>
              <p className="empty-hint">只搜已经扫进地图的部分;没探开的文件夹,先去树上点箭头展开</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
