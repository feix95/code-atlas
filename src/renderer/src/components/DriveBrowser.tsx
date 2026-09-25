// 「这台电脑」下钻浏览(UI v3 §7.1):侧栏空态 = 盘符列表,单击目录原地展开
// (懒加载纯浏览,不开工作区),双击目录 = 打开为工作区,单击文件 = 开预览页签。
// 行骨架沿用树行(0.75u 高/图标位可转圈/摘三角),手感与文件树一致;
// 浏览账在 useDriveBrowser —— 没点过的层才来这儿画名字。
import type { DriveInfo } from '@shared/types'
import { driveCapacity, driveKindName } from '../driveMeta'
import { useDriveBrowser, type BrowseDir, type BrowseNode } from '../useDriveBrowser'
import { TreeIcon } from './Icons'

/** 与 FileTree 同一颗图标旋钮(§7 ≈1.1rem) */
const BROWSE_ICON_SIZE = 18

export function DriveBrowser({
  drives,
  drivesNote,
  onOpenWorkspace,
  onOpenFile
}: {
  drives: DriveInfo[] | null
  drivesNote: string | null
  /** 双击目录(含盘根本身):绝对路径原样回传,走地址栏同一条扫描路 */
  onOpenWorkspace: (absPath: string) => void
  /** 单击文件:开「瞄一眼」预览页签(scopeRoot = 这棵树的盘根) */
  onOpenFile: (scopeRoot: string, file: { name: string; relPath: string }) => void
}): React.JSX.Element {
  const { trees, toggleDir } = useDriveBrowser()
  if (drives === null && !drivesNote) {
    return (
      <div className="drive-browser">
        <p className="drive-browser-note">正在列盘符……</p>
      </div>
    )
  }
  if (drivesNote) {
    return (
      <div className="drive-browser">
        <p className="drive-browser-note">{drivesNote}</p>
      </div>
    )
  }
  return (
    <div className="tree-scroll">
      <div className="tree">
        {(drives ?? []).map((d) => (
          <BrowseDirRow
            key={d.letter}
            root={trees[d.root] ?? freshRootFor(d)}
            drive={d}
            depth={0}
            toggleDir={toggleDir}
            onOpenWorkspace={onOpenWorkspace}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </div>
  )
}

/** 还没点过的盘没有树账:现捏一个门面行(点开才当真去列第一层) */
function freshRootFor(d: DriveInfo): BrowseDir {
  return {
    type: 'directory',
    name: `${d.letter}:\\`,
    relPath: '',
    absPath: d.root,
    open: false,
    loading: false,
    error: null,
    children: null
  }
}

function BrowseDirRow({
  root,
  drive,
  depth,
  toggleDir,
  onOpenWorkspace,
  onOpenFile
}: {
  root: BrowseDir
  drive: DriveInfo
  depth: number
  toggleDir: (d: DriveInfo, relPath: string) => Promise<void>
  onOpenWorkspace: (absPath: string) => void
  onOpenFile: (scopeRoot: string, file: { name: string; relPath: string }) => void
}): React.JSX.Element {
  const isDriveRoot = root.relPath === ''
  return (
    <div className="tree-branch">
      <div className="tree-row is-dir" style={{ paddingLeft: `${(depth * 1.125).toFixed(4)}rem` }}>
        <button
          type="button"
          className="tree-main"
          aria-expanded={root.children !== null ? root.open : undefined}
          data-tip={
            isDriveRoot
              ? `${driveKindName(drive)} · ${driveCapacity(drive)} —— 双击打开为工作区`
              : `${root.absPath} —— 双击打开为工作区`
          }
          data-tip-side="right"
          onClick={() => void toggleDir(drive, root.relPath)}
          onDoubleClick={() => onOpenWorkspace(root.absPath)}
        >
          <span className="tree-icon" aria-hidden="true">
            {root.loading ? (
              <span className="tree-spin" aria-hidden="true" />
            ) : (
              <TreeIcon name={isDriveRoot ? 'drive' : 'folder'} size={BROWSE_ICON_SIZE} />
            )}
          </span>
          <span className="tree-name">{root.name}</span>
          {root.error && (
            <span className="tree-summary" role="status">
              {root.error}
            </span>
          )}
        </button>
      </div>
      {root.open &&
        root.children !== null &&
        (root.children.length === 0 ? (
          <p
            className="drive-browser-note"
            style={{ paddingLeft: `${((depth + 1) * 1.125).toFixed(4)}rem` }}
          >
            这层是空的
          </p>
        ) : (
          root.children.map((child) => (
            <BrowseChildRow
              key={child.name}
              node={child}
              drive={drive}
              depth={depth + 1}
              toggleDir={toggleDir}
              onOpenWorkspace={onOpenWorkspace}
              onOpenFile={onOpenFile}
            />
          ))
        ))}
    </div>
  )
}

function BrowseChildRow({
  node,
  drive,
  depth,
  toggleDir,
  onOpenWorkspace,
  onOpenFile
}: {
  node: BrowseNode
  drive: DriveInfo
  depth: number
  toggleDir: (d: DriveInfo, relPath: string) => Promise<void>
  onOpenWorkspace: (absPath: string) => void
  onOpenFile: (scopeRoot: string, file: { name: string; relPath: string }) => void
}): React.JSX.Element {
  if (node.type === 'file') {
    return (
      <div className="tree-row is-file" style={{ paddingLeft: `${(depth * 1.125).toFixed(4)}rem` }}>
        <button
          type="button"
          className="tree-main"
          data-tip={node.absPath}
          data-tip-side="right"
          onClick={() => onOpenFile(drive.root, { name: node.name, relPath: node.relPath })}
        >
          <span className="tree-icon" aria-hidden="true">
            <TreeIcon name="file" size={BROWSE_ICON_SIZE} />
          </span>
          <span className="tree-name">{node.name}</span>
        </button>
      </div>
    )
  }
  return (
    <BrowseDirRow
      root={node}
      drive={drive}
      depth={depth}
      toggleDir={toggleDir}
      onOpenWorkspace={onOpenWorkspace}
      onOpenFile={onOpenFile}
    />
  )
}
