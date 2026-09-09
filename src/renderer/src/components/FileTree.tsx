import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScanDirNode, ScanFileNode, ScanTreeNode } from '@shared/types'
import type { NoteMap } from '@shared/notes'
import { NotePen, TreeIcon } from './Icons'

interface TreeRowProps {
  node: ScanTreeNode
  depth: number
  /** 本项目的手动备注表:备注过的行亮小葵自己的话,压过引擎一句话 */
  notes?: NoteMap
  /** 右键菜单(第一百零二锤):编辑备注的直接入口 */
  onRowContextMenu?: (e: React.MouseEvent, node: ScanTreeNode) => void
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
function TreeRow({ node, depth, notes, onRowContextMenu, selectedPath, expandingPath, filter, onSelectFile, onSelectFolder, onExpandLazy }: TreeRowProps): React.JSX.Element | null {
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
    const note = notes?.[node.relPath]
    // 缩进挂 rem(每层 18px 基准 = 1.125rem),跟着根字号一起缩放
    return (
      <div className={`tree-row is-file${selectedPath === node.relPath ? ' is-selected' : ''}`} style={{ paddingLeft: `${(depth * 1.125).toFixed(4)}rem` }}>
        <span className="tree-caret" aria-hidden="true" />
        <button
          type="button"
          className="tree-main"
          onClick={() => onSelectFile(node.relPath, node)}
          onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, node) : undefined}
          title={node.summary?.text}
        >
          <span className="tree-icon" aria-hidden="true">
            {<TreeIcon name={node.summary?.icon ?? 'file'} />}
          </span>
          <span className="tree-name">{node.name}</span>
          {note ? (
            <span className="tree-summary is-note" title={`我的备注:${note.text}`}>
              <NotePen />
              {note.text}
            </span>
          ) : (
            node.summary && <span className="tree-summary">{node.summary.text}</span>
          )}
          {node.ext && <span className="tree-tag">{node.ext.slice(1).toUpperCase()}</span>}
        </button>
      </div>
    )
  }

  const dir = node
  const dirNote = notes?.[dir.relPath]

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
        style={{ paddingLeft: `${(depth * 1.125).toFixed(4)}rem` }}
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
        <button
          type="button"
          className="tree-main"
          onClick={() => onSelectFolder(dir)}
          onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, dir) : undefined}
          title={dir.summary?.text}
        >
          <span className="tree-icon" aria-hidden="true">
            {<TreeIcon name={dir.summary?.icon ?? 'folder'} />}
          </span>
          <span className="tree-name">{dir.name}</span>
          {dirNote ? (
            <span className="tree-summary is-note" title={`我的备注:${dirNote.text}`}>
              <NotePen />
              {dirNote.text}
            </span>
          ) : (
            dir.summary && <span className="tree-summary">{dir.summary.text}</span>
          )}
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
            notes={notes}
            onRowContextMenu={onRowContextMenu}
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
  /** 本项目手动备注表(第九十八锤);不传就只亮引擎一句话 */
  notes?: NoteMap
  selectedPath: string | null
  expandingPath: string | null
  onSelectFile: (relPath: string, file: ScanFileNode) => void
  onSelectFolder: (node: ScanDirNode) => void
  onExpandLazy: (relPath: string) => void
  /** 右键「写/编辑备注」:App 负责选中节点并弹详情页的编辑框 */
  onNoteEdit?: (relPath: string) => void
  /** 右键「清除备注」 */
  onNoteRemove?: (relPath: string) => void
}

export function FileTree({ root, notes, selectedPath, expandingPath, onSelectFile, onSelectFolder, onExpandLazy, onNoteEdit, onNoteRemove }: FileTreeProps): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  // 右键菜单:记住在谁身上、屏幕哪个位置;点别处/再右键即收
  const [menu, setMenu] = useState<{ x: number; y: number; relPath: string; hasNote: boolean } | null>(null)

  function handleRowContextMenu(e: React.MouseEvent, node: ScanTreeNode): void {
    if (!onNoteEdit) return
    e.preventDefault()
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 170),
      y: Math.min(e.clientY, window.innerHeight - 110),
      relPath: node.relPath,
      hasNote: notes?.[node.relPath] !== undefined
    })
  }

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
              notes={notes}
              onRowContextMenu={handleRowContextMenu}
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
              <p className="empty-hint">只搜已扫描的部分;没展开的文件夹,先点箭头展开</p>
            </div>
          )}
        </div>
      </div>
      {menu && (
        <>
          <div
            className="menu-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div className="tree-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onNoteEdit?.(menu.relPath)
                setMenu(null)
              }}
            >
              {menu.hasNote ? '编辑备注' : '写备注'}
            </button>
            {menu.hasNote && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onNoteRemove?.(menu.relPath)
                  setMenu(null)
                }}
              >
                清除备注
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}
