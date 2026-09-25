import { useEffect, useRef, useState } from 'react'
import type { ScanDirNode, ScanFileNode, ScanTreeNode } from '@shared/types'
import { DRAG_MIME_NODE } from '@shared/dragTypes'
import type { NoteMap } from '@shared/notes'
import { NotePen, TreeIcon } from './Icons'
import { openFilePathMenuFor } from './filePathMenuStore'

/** 文件树图标总控:本树内所有 icon(文件/文件夹)共享这一个尺寸,改这里全场生效;
 *  只管这棵树,跟其他区域的图标尺寸互不相干。UI v3 §7 ≈1.1rem = 18px@100% */
const TREE_ICON_SIZE = 18

interface TreeRowProps {
  node: ScanTreeNode
  depth: number
  /** 本项目的手动备注表:备注过的行亮小葵自己的话,压过引擎一句话 */
  notes?: NoteMap
  /** 右键菜单(第一百零二锤起,现统一走全局文件菜单):把节点报给 App 层换动作 */
  onRowContextMenu?: (e: React.MouseEvent, node: ScanTreeNode) => void
  selectedPath: string | null
  /** 正在点开探测的目录 relPath(分级扫描转圈提示) */
  expandingPath: string | null
  /** reveal 联动:这条链上的目录强制展开(页签/绿字跳过来的文件,树里可能还收着) */
  forceExpand?: boolean
  onSelectFile: (relPath: string, file: ScanFileNode) => void
  onSelectFolder: (node: ScanDirNode) => void
  onExpandLazy: (relPath: string) => void
  /** 双击文件 = 打开预览页签(小葵的页签模型):右栏「文件预览」品类跟着亮 */
  onPreviewFile?: (relPath: string) => void
}

// 路径契约:relPath 由扫描器生成并存在节点上,界面只读取、绝不拼接
function TreeRow({
  node,
  depth,
  notes,
  onRowContextMenu,
  selectedPath,
  expandingPath,
  forceExpand,
  onSelectFile,
  onSelectFolder,
  onExpandLazy,
  onPreviewFile
}: TreeRowProps): React.JSX.Element | null {
  // 首层文件夹默认展开,再深的收起来,避免一上来铺满屏
  const [open, setOpen] = useState(depth < 1)
  // 分级扫描:点箭头把还没探的目录探进来;探完(节点从 lazy 变实)自动张开给孩子看
  const wasLazy = useRef(false)
  useEffect(() => {
    const lazy = node.type === 'directory' ? (node.lazy ?? false) : false
    if (wasLazy.current && !lazy) setOpen(true)
    wasLazy.current = lazy
  }, [node])

  // reveal 链上的目录一律摊开,不看你之前的展开手癖
  const expanded = open || !!forceExpand

  if (node.type === 'file') {
    const note = notes?.[node.relPath]
    // 注释小灰字退役:行内只留「有备注」的笔帽小标,话本身挪进悬停提示(右侧出)
    const tip = [note ? `我的备注:${note.text}` : '', node.summary?.text ?? '']
      .filter(Boolean)
      .join('\n')
    // 缩进吃 --tree-indent token(rem 记账),跟着根字号一起缩放
    return (
      <div
        className={`tree-row is-file${selectedPath === node.relPath ? ' is-selected' : ''}`}
        style={{ paddingLeft: `calc(${depth} * var(--tree-indent))` }}
      >
        <button
          type="button"
          className="tree-main"
          draggable
          data-reveal-file={node.relPath}
          onDragStart={(e) => {
            // 拖拽挂引用(第一百二十五锤):带上类型,文件夹到了对面好指路
            e.dataTransfer.setData(
              DRAG_MIME_NODE,
              JSON.stringify({ kind: 'file', relPath: node.relPath })
            )
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => onSelectFile(node.relPath, node)}
          onDoubleClick={() => onPreviewFile?.(node.relPath)}
          onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, node) : undefined}
          data-tip={tip || undefined}
          data-tip-side="right"
        >
          <span className="tree-icon" aria-hidden="true">
            {<TreeIcon name={node.summary?.icon ?? 'file'} size={TREE_ICON_SIZE} mono={false} />}
          </span>
          <span className="tree-name">{node.name}</span>
          {note && (
            <span className="tree-note-mark" aria-hidden="true">
              <NotePen mono={false} />
            </span>
          )}
        </button>
      </div>
    )
  }

  const dir = node
  const dirNote = notes?.[dir.relPath]
  // 注释小灰字退役:摘要/备注/子项数都挪进悬停提示;琥珀警示徽章仍常亮(留个心眼不藏进悬停)
  const dirTip = [
    dirNote ? `我的备注:${dirNote.text}` : '',
    dir.summary?.text ?? '',
    !dir.lazy && dir.children.length > 0 ? `${dir.children.length} 个子项` : ''
  ]
    .filter(Boolean)
    .join('\n')

  // 展开/收起(UI v3 §7 摘三角:单击文件夹行 = 选中+展开一体,行首不再摆箭头);
  // 没探过的目录,点行才是触发扫描的唯一入口
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
        style={{ paddingLeft: `calc(${depth} * var(--tree-indent))` }}
        onKeyDown={onRowKeyDown}
      >
        <button
          type="button"
          className="tree-main"
          aria-expanded={dir.lazy ? undefined : expanded}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(
              DRAG_MIME_NODE,
              JSON.stringify({ kind: 'folder', relPath: dir.relPath })
            )
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => {
            // 单击左键 = 选中 + 展开/收起一把抓(小葵点名);没探过的顺势扫描。
            // 主文件夹例外(第一百三十五锤):点根 = 选中 + 保证展开,永不收起 ——
            // 收起根节点整棵树缩成光杆,没有使用价值,点它的人只想要项目概况;
            // 真想收根节点,键盘左箭头那条路还在
            onSelectFolder(dir)
            if (dir.relPath === '') {
              if (!expanded && dir.lazy) onExpandLazy(dir.relPath)
              else if (!expanded) setOpen(true)
              return
            }
            toggleExpand()
          }}
          onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, dir) : undefined}
          data-tip={dirTip || undefined}
          data-tip-side="right"
        >
          <span className="tree-icon" aria-hidden="true">
            {/* 探层中的转圈挪进图标位(UI v3 摘三角后没有箭头坑位了) */}
            {expandingPath === dir.relPath ? (
              <span className="tree-spin" aria-hidden="true" />
            ) : (
              <TreeIcon name="folder" size={TREE_ICON_SIZE} mono={false} />
            )}
          </span>
          <span className="tree-name">{dir.name}</span>
          {dirNote && (
            <span className="tree-note-mark" aria-hidden="true">
              <NotePen mono={false} />
            </span>
          )}
          {/* 未扫描/不完整都是琥珀色:是「留个心眼」不是「出事了」,红色只留给真失败 */}
          {dir.lazy && <span className="tree-badge is-warn">未扫描</span>}
          {dir.truncated && !dir.lazy && <span className="tree-badge is-warn">不完整</span>}
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
            forceExpand={forceExpand}
            onSelectFile={onSelectFile}
            onSelectFolder={onSelectFolder}
            onExpandLazy={onExpandLazy}
            onPreviewFile={onPreviewFile}
          />
        ))}
    </div>
  )
}

interface FileTreeProps {
  root: ScanDirNode
  /** 项目根(导向菜单用,菜单统一大锤):复制完整路径/资源管理器显示,得知道扫描根才拼得出绝对路径 */
  rootPath?: string
  /** 本项目手动备注表(第九十八锤);不传就只亮引擎一句话 */
  notes?: NoteMap
  selectedPath: string | null
  expandingPath: string | null
  /** reveal 联动(页签地基):激活的页签/跳转目标在树里的父目录链,这些目录强制展开 */
  revealPaths?: Set<string>
  onSelectFile: (relPath: string, file: ScanFileNode) => void
  onSelectFolder: (node: ScanDirNode) => void
  onExpandLazy: (relPath: string) => void
  /** 右键「写/编辑备注」的原料(菜单统一走全局):App 负责选中节点并弹详情页的编辑框 */
  onNoteEdit?: (relPath: string) => void
  /** 右键「清除备注」的原料 */
  onNoteRemove?: (relPath: string) => void
  /** 右键「预览文件」的原料(第一百一十锤):开/激活预览页签 */
  onPreviewFile?: (relPath: string) => void
}

export function FileTree({
  root,
  rootPath,
  notes,
  selectedPath,
  expandingPath,
  revealPaths,
  onSelectFile,
  onSelectFolder,
  onExpandLazy,
  onNoteEdit,
  onNoteRemove,
  onPreviewFile
}: FileTreeProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)

  // reveal 联动的后半程:展开靠 forceExpand 已由渲染接管,这里只负责把目标行滚进视野。
  // 纯 DOM 操作不碰 state,树没扫到目标(链上目录收着)时查不到节点,静静放过
  useEffect(() => {
    if (!selectedPath) return
    const el = scrollRef.current?.querySelector(`[data-reveal-file="${selectedPath}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedPath, revealPaths])

  /** 右键统一走全局文件菜单(菜单统一大锤):带路两件 + 预览(文件) + 备注系列,
   *  一份实现四处共用 —— 树只管报「在谁身上、鼠标在哪」,菜单的贴边/收摊/反馈都是全局那张的事 */
  function handleRowContextMenu(e: React.MouseEvent, node: ScanTreeNode): void {
    if (!rootPath) return
    e.preventDefault()
    const isFile = node.type === 'file'
    openFilePathMenuFor(rootPath, node.relPath, e.clientX, e.clientY, {
      preview: isFile && onPreviewFile ? () => onPreviewFile(node.relPath) : undefined,
      note: onNoteEdit
        ? {
            hasNote: notes?.[node.relPath] !== undefined,
            onEdit: () => onNoteEdit(node.relPath),
            onRemove: onNoteRemove ? () => onNoteRemove(node.relPath) : undefined
          }
        : undefined
    })
  }

  return (
    <>
      <div className="tree-scroll" ref={scrollRef}>
        <div className="tree">
          <TreeRow
            node={root}
            depth={0}
            notes={notes}
            onRowContextMenu={handleRowContextMenu}
            selectedPath={selectedPath}
            expandingPath={expandingPath}
            forceExpand={revealPaths?.has(root.relPath)}
            onSelectFile={onSelectFile}
            onSelectFolder={onSelectFolder}
            onExpandLazy={onExpandLazy}
            onPreviewFile={onPreviewFile}
          />
        </div>
      </div>
    </>
  )
}
