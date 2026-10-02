// 平台规范提醒面板(§5.7):工具栏「规范」chip 点开,列出当前方案的规范问题。
// 提醒不拦截导出;点变量条目跳到变量板对应行,点组件条目跳组件墙。
import type { PlatformIssue } from '@shared/uiFrame/platformRules'

export function UiFrameRules({
  issues,
  onPick,
  onClose
}: {
  issues: PlatformIssue[]
  onPick: (target: string) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="uf-rules" role="dialog" aria-label="平台规范提醒">
      <div className="uf-rules-head">
        <span>平台规范提醒 · {issues.length} 条</span>
        <button type="button" className="btn btn-ghost uf-rules-x" onClick={onClose}>
          收起
        </button>
      </div>
      {issues.length === 0 ? (
        <p className="uf-rules-empty">当前方案通过全部平台规范检查</p>
      ) : (
        <ul className="uf-rules-list">
          {issues.map((i, n) => (
            <li key={n} className={`uf-rules-item is-${i.level}`}>
              <span className={`uf-rules-dot is-${i.level}`} aria-hidden="true" />
              <span className="uf-rules-rule">{i.rule}</span>
              <button
                type="button"
                className="uf-rules-target"
                title={`定位到 ${i.target}`}
                onClick={() => onPick(i.target)}
              >
                {i.target}
              </button>
              <span className="uf-rules-msg">{i.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
