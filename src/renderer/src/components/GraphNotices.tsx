// 关系图谱的状态提示:引用分析失败、文件夹读取失败、原地展开被拒。
import type { ExpansionNotice } from '../graph/useGraphExpansion'
import { Notice } from './Notice'

const SCAN_FAILED = '这个文件夹暂时打不开,请稍后再试'

interface GraphNoticesProps {
  graphNote: string | null
  scanFailed: boolean
  expansionNotice: ExpansionNotice | null
  onRetry: () => void
}

export function GraphNotices(props: GraphNoticesProps): React.JSX.Element {
  return (
    <div className="graph-notices">
      {props.graphNote && (
        <Notice kind="error">
          引用关系分析失败:{props.graphNote}
          <button type="button" className="graph-retry" onClick={props.onRetry}>
            重试
          </button>
        </Notice>
      )}
      {props.scanFailed && <Notice kind="error">{SCAN_FAILED}</Notice>}
      {props.expansionNotice && (
        <Notice kind={props.expansionNotice.kind === 'scanFailed' ? 'error' : 'info'}>
          {props.expansionNotice.kind === 'scanFailed'
            ? SCAN_FAILED
            : '内容较多,无法原地展开,右键文件夹选「进入此文件夹」查看'}
        </Notice>
      )}
    </div>
  )
}
