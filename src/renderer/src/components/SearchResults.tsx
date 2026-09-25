// 工作区文件名深搜的结果清单(UI v3 §7.2):搜索词非空时整体替换侧栏文件树。
// 行规格沿用树行(0.75u 高/图标/主名+摘要位);文件命中点开预览页签,
// 文件夹命中打开为工作区 —— 深搜扫到的可能住在「还没探」的目录里,
// 打开前的探链补课在 App 的 openSearchFile 里。
import type { SearchNameHit } from '../../../shared/searchNames.ts'
import { SEARCH_NAMES_MAX } from '../../../shared/searchNames.ts'
import { TreeIcon } from './Icons'

/** 与 FileTree 同一颗图标旋钮(文件树外一律单色) */
const HIT_ICON_SIZE = 18

export function SearchResults({
  query,
  hits,
  searching,
  truncated,
  stoppedEarly,
  onOpenFile,
  onOpenDir
}: {
  query: string
  hits: SearchNameHit[]
  /** 「搜索中…」中间态(防抖还没出结果/主进程还在走) */
  searching: boolean
  truncated: boolean
  /** 保护闸挡住了继续深探:清单只是前半程,照实垫一句 */
  stoppedEarly: boolean
  onOpenFile: (hit: SearchNameHit) => void
  onOpenDir: (hit: SearchNameHit) => void
}): React.JSX.Element {
  return (
    <div className="tree-scroll">
      <div className="tree search-results" role="listbox" aria-label="搜索结果">
        {searching ? (
          <p className="sr-state">搜索中…</p>
        ) : hits.length === 0 ? (
          <p className="sr-state">没找到叫「{query}」的文件或文件夹</p>
        ) : (
          <>
            {hits.map((hit) => (
              <div
                key={hit.relPath}
                className={`tree-row is-${hit.kind === 'directory' ? 'dir' : 'file'}`}
              >
                <button
                  type="button"
                  className="tree-main"
                  title={hit.relPath}
                  onClick={() => (hit.kind === 'directory' ? onOpenDir(hit) : onOpenFile(hit))}
                >
                  <span className="tree-icon" aria-hidden="true">
                    <TreeIcon
                      name={hit.kind === 'directory' ? 'folder' : 'file'}
                      size={HIT_ICON_SIZE}
                      mono
                    />
                  </span>
                  <span className="tree-name">{hit.name}</span>
                  {hit.dirRel !== '' && <span className="tree-summary">{hit.dirRel}/</span>}
                </button>
              </div>
            ))}
            {truncated && <p className="sr-state">仅显示前 {SEARCH_NAMES_MAX} 条</p>}
            {!truncated && stoppedEarly && (
              <p className="sr-state">文件夹太大,只搜了前半程;缩小范围再试</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
