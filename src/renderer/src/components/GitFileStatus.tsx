import type { GitChangesResult } from '@shared/types'
import { TurnText } from './AiAssist'
import { useAiAsk, type AiAssistApi } from '../useAiAsk'
import { Badge } from './DetailHeader'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

const KIND_LABEL: Record<GitChangesResult['changes'][number]['kind'], string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
  untracked: '新文件'
}

/**
 * 「修改建议」Tab:这个文件在 git 里有没有未提交的改动,一眼看到;
 * 有改动可以让 AI 对着 diff 讲「这次改了啥」,没改动可以问 AI「改它会影响什么」
 * (问题走「解释」通道,答案在概览页的 AI 助手卡里流式出来)。
 */
export function GitFileStatus({
  gitInfo,
  gitLoading,
  rootPath,
  relPath,
  onOpenGit,
  ai,
  onGoOverview
}: {
  gitInfo: GitChangesResult | null
  gitLoading: boolean
  rootPath: string
  relPath: string
  onOpenGit: () => void
  /** 文件 AI 助手(问题进解释通道) */
  ai: AiAssistApi
  onGoOverview: () => void
}): React.JSX.Element {
  if (gitLoading && !gitInfo) {
    return (
      <div className="card-waiting">
        <ProgressDots />
        正在翻 git 的账本……
      </div>
    )
  }
  if (!gitInfo) {
    return (
      <Notice kind="info">
        Git 状态还没查到。{' '}
        <button type="button" className="btn btn-ghost" onClick={onOpenGit}>
          打开 Git 面板看详情
        </button>
      </Notice>
    )
  }
  if (!gitInfo.isGitRepo) {
    return (
      <Notice kind="info">这个文件夹还不是 git 仓库,没有改动记录可看。选项目根目录(有 .git 的那层)再试。</Notice>
    )
  }
  const change = gitInfo.changes.find((c) => c.relPath === relPath)
  return (
    <>
      <div className="section-label">
        修改建议 <span>结合影响范围和当前 Git 状态</span>
      </div>
      <section className="card">
        {change ? (
          <>
            <div className="git-change-line">
              <Badge
                label={KIND_LABEL[change.kind]}
                tone={change.kind === 'deleted' ? 'red' : change.kind === 'added' ? 'green' : 'blue'}
              />
              {change.staged && change.kind !== 'untracked' && <Badge label="已暂存" tone="muted" />}
              {change.additions >= 0 && (
                <span className="git-numstat">
                  <span className="git-add">+{change.additions}</span> <span className="git-del">−{change.deletions}</span>
                </span>
              )}
            </div>
            <ExplainChangeBlock rootPath={rootPath} relPath={relPath} />
          </>
        ) : (
          <p className="card-text">这个文件当前没有未提交的改动。</p>
        )}
        <div className="ai-card-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={ai.busy}
            onClick={() => {
              // 问题发进解释通道,概览页的助手卡里看答案
              ai.ask('修改它会影响什么？')
              onGoOverview()
            }}
          >
            {ai.busy ? 'AI 正在回答……' : '问 AI:改它会影响什么？'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onOpenGit}>
            查看全部 Git 改动
          </button>
        </div>
      </section>
    </>
  )
}

/** 「让 AI 讲讲这次改了啥」:对着 git diff 的单问单答,状态机与文件助手同款 */
function ExplainChangeBlock({ rootPath, relPath }: { rootPath: string; relPath: string }): React.JSX.Element {
  const ai = useAiAsk((requestId) => window.atlas.gitExplainChange(rootPath, relPath, requestId))
  const turn = ai.turns.length > 0 ? ai.turns[ai.turns.length - 1] : null

  return (
    <div className="explain">
      <div className="explain-head">
        <span className="explain-title">这次改了啥</span>
        {(!turn || turn.state !== 'busy') && (
          <button type="button" className="btn" onClick={() => ai.ask(null)}>
            {turn ? '再讲一次' : '让 AI 讲讲这次改了啥'}
          </button>
        )}
        {turn?.state === 'busy' && (
          <button type="button" className="btn" onClick={ai.cancel}>
            取消分析
          </button>
        )}
      </div>
      {turn && <TurnText turn={turn} />}
    </div>
  )
}
