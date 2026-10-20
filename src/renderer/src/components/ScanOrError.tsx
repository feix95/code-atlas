// 扫描中/打开失败的整屏状态(纯迁移自 App):扫描进度卡与错误卡各管一半,
// App 只留「画哪一屏」的分支,不再端着两份长 JSX。
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

export function ScanOrError({
  scanning,
  error,
  onRetry,
  onPick,
  onGoHome
}: {
  scanning: boolean
  error: string | null
  /** 「重试」:有工作区重扫一遍,没有就走挑文件夹 */
  onRetry: () => void
  /** 「选择项目文件夹」:弹系统选目录 */
  onPick: () => void
  onGoHome: () => void
}): React.JSX.Element {
  return (
    <main className="content">
      {scanning && (
        <div className="state" role="status" aria-live="polite">
          <h1>正在整理项目地图…</h1>
          <ProgressDots />
          <p>只读取文件,不会修改代码。文件较多时可以返回首页,换一个更小的文件夹。</p>
          <button type="button" className="btn" onClick={onGoHome}>
            返回首页
          </button>
        </div>
      )}
      {!scanning && error && (
        <div className="state" role="alert">
          <h1>这个文件夹没能打开</h1>
          <Notice kind="error">{error}</Notice>
          <p>可以重试,或重新选择项目文件夹。</p>
          <div className="state-actions">
            <button type="button" className="btn btn-primary" onClick={onRetry}>
              重试
            </button>
            <button type="button" className="btn" onClick={onPick}>
              选择项目文件夹
            </button>
            <button type="button" className="btn btn-ghost" onClick={onGoHome}>
              返回首页
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
