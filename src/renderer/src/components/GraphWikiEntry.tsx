// 图谱顶栏的 Wiki 入口:生成确认弹窗与进度页转场都收在这一件里。
import { useState } from 'react'
import type { DepGraphResult, ScanResult } from '@shared/types'
import { WikiGenerateDialog } from './WikiGenerateDialog'

export function GraphWikiEntry({
  result,
  graph,
  onOpenWiki,
  wallVisible,
  onToggleWall
}: {
  result: ScanResult
  /** 关系分析还没到货时不能生成:清单靠它切模块 */
  graph: DepGraphResult | null
  onOpenWiki: () => void
  /** 卡片墙当前是否盖在画布上;传入时多一个结构图/卡片墙切换钮 */
  wallVisible?: boolean
  onToggleWall?: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="graph-tool-text"
        disabled={graph === null}
        onClick={() => setOpen(true)}
      >
        生成 Wiki
      </button>
      <button type="button" className="graph-tool-text" onClick={onOpenWiki}>
        Wiki 进度
      </button>
      {onToggleWall && (
        <button type="button" className="graph-tool-text" onClick={onToggleWall}>
          {wallVisible ? '结构图' : '卡片墙'}
        </button>
      )}
      {open && graph !== null && (
        <WikiGenerateDialog
          result={result}
          graph={graph}
          onClose={() => setOpen(false)}
          onStarted={() => {
            setOpen(false)
            onOpenWiki()
          }}
        />
      )}
    </>
  )
}
