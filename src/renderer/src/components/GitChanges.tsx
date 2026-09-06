import { useEffect, useRef, useState } from 'react'
import type { AiExplainResult, GitChange, GitChangesResult } from '@shared/types'
import { friendlyErr } from '../errText'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

/** 掐掉还在路上的生成:换了文件/刷新/关面板时喊一声,模型立刻空出来 */
function cancelExplain(id: string): void {
  if (id) void window.atlas.aiCancel(id)
}

const KIND_LABEL: Record<GitChange['kind'], string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
  untracked: '新文件'
}

function StatLine({ add, del }: { add: number; del: number }): React.JSX.Element {
  if (add < 0 || del < 0) return <span className="git-numstat is-binary">二进制</span>
  return (
    <span className="git-numstat">
      <span className="git-add">+{add}</span> <span className="git-del">−{del}</span>
    </span>
  )
}

// git 修改卡(第六十五锤起住在右栏 git 门的展开层里):挂载时收一遍改动清单(外部已有总账就直用,不重复跑 git),
// 点文件行选中,再让本地模型用人话讲这个改动。
// 路径契约由主进程保证,这里只递 (rootPath, relPath)。
export function GitChanges({
  rootPath,
  onJump,
  initial,
  onRefreshed
}: {
  rootPath: string
  onJump: (relPath: string) => void
  /** App 开图时顺手查过的总账;有就直用,不重复跑 git 命令 */
  initial?: GitChangesResult
  /** 刷新拿到新账后回传 App,让详情头部的 git 徽章跟着新 */
  onRefreshed?: (result: GitChangesResult) => void
}): React.JSX.Element {
  const [loading, setLoading] = useState(!initial)
  const [result, setResult] = useState<GitChangesResult | null>(initial ?? null)
  const [note, setNote] = useState<string | null>(null)
  const [selected, setSelected] = useState<GitChange | null>(null)
  const [explain, setExplain] = useState<AiExplainResult | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [streamText, setStreamText] = useState('')
  // AI 干活报告(第六十三锤):整轮改动的大白话审计,和单文件讲解各自一条线,流式互不串线
  const [report, setReport] = useState<AiExplainResult | null>(null)
  const [reporting, setReporting] = useState(false)
  const [reportStream, setReportStream] = useState('')
  const idRef = useRef('')
  const reportIdRef = useRef('')
  // 初值只在挂载时认一次:之后 App 那份变了也不回退用户看到的账
  const initialRef = useRef(initial)

  // 订阅 AI 流式增量:按 id 分账,讲解和报告各进各的;组件卸载时退订,防止泄漏监听
  useEffect(() => {
    return window.atlas.onAiDelta((payload) => {
      if (payload.id === idRef.current) setStreamText((prev) => prev + payload.text)
      if (payload.id === reportIdRef.current) setReportStream((prev) => prev + payload.text)
    })
  }, [])

  // 组件卸载(关掉 git 面板/换布局)时,把还在生成的讲解/报告都掐掉,别占着模型
  useEffect(() => {
    return () => {
      if (idRef.current) void window.atlas.aiCancel(idRef.current)
      if (reportIdRef.current) void window.atlas.aiCancel(reportIdRef.current)
    }
  }, [])

  // 挂载时收一遍(App 已经查过总账就跳过);setState 都发生在 await 之后,不在 effect 里同步触发。
  // cancelled 守卫:慢响应回来时文件夹已经换了,不许旧账盖新账
  useEffect(() => {
    if (initialRef.current) return
    let cancelled = false
    void (async (): Promise<void> => {
      try {
        const r = await window.atlas.gitChanges(rootPath)
        if (cancelled) return
        setResult(r)
        setSelected(null)
        setExplain(null)
        setNote(null)
      } catch (err) {
        if (!cancelled) setNote(friendlyErr(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rootPath])

  async function handleRefresh(): Promise<void> {
    setLoading(true)
    setNote(null)
    // 讲解/报告若在路上,先掐掉:刷新后旧账作废,旧讲解旧报告不许挂回来
    cancelExplain(idRef.current)
    idRef.current = ''
    setExplaining(false)
    setStreamText('')
    cancelExplain(reportIdRef.current)
    reportIdRef.current = ''
    setReporting(false)
    setReportStream('')
    setReport(null)
    try {
      const r = await window.atlas.gitChanges(rootPath)
      setResult(r)
      setSelected(null)
      setExplain(null)
      onRefreshed?.(r) // 回传 App:头部徽章和修改建议 Tab 跟着新账走
    } catch (err) {
      setNote(friendlyErr(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleExplain(): Promise<void> {
    if (!selected) return
    const requestId = crypto.randomUUID()
    setExplaining(true)
    setExplain(null)
    setStreamText('')
    idRef.current = requestId
    try {
      // 路径契约:只递 relPath,diff 由主进程现场重取,前端传不了假货
      const res = await window.atlas.gitExplainChange(rootPath, selected.relPath, requestId)
      if (idRef.current !== requestId) return // 中途换了文件/刷新,这份旧账作废
      setExplain(res)
    } catch (err) {
      if (idRef.current !== requestId) return
      setExplain({ status: 'error', text: friendlyErr(err), model: '', durationMs: 0 })
    } finally {
      if (idRef.current === requestId) setExplaining(false)
    }
  }

  /** 生成本轮报告:账本由主进程现场重取,签名没变直接回缓存,不重复烧模型 */
  async function handleReport(): Promise<void> {
    const requestId = crypto.randomUUID()
    setReporting(true)
    setReport(null)
    setReportStream('')
    reportIdRef.current = requestId
    try {
      const res = await window.atlas.gitReport(rootPath, requestId)
      if (reportIdRef.current !== requestId) return // 中途刷新了,这份旧账作废
      setReport(res)
    } catch (err) {
      if (reportIdRef.current !== requestId) return
      setReport({ status: 'error', text: friendlyErr(err), model: '', durationMs: 0 })
    } finally {
      if (reportIdRef.current === requestId) {
        setReporting(false)
        reportIdRef.current = ''
      }
    }
  }

  if (loading) return <div className="structure-note"><ProgressDots />正在翻 git 的账本,看看谁动了代码……</div>
  if (note) return <Notice kind="error">⚠️ {note}</Notice>
  if (!result) return <div className="structure-note">git 的账本还没递过来,点一下「🔄 刷新」再试一次?</div>

  if (!result.isGitRepo) {
    return (
      <Notice kind="info">
        这个文件夹还不是 git 仓库,git 还没开始给它记账。
        <br />
        两个办法:① 选项目根目录(里面有 .git 隐藏文件夹的那层);② 或者在项目里跑一次 <code>git init</code>(先跟项目主人打个招呼哦)。
      </Notice>
    )
  }

  return (
    <div className="git">
      <div className="git-head">
        <span className="git-branch">🌿 {result.branch}</span>
        <span className="chip is-muted">
          {result.stats.changed} 个文件改动 · <span className="git-add">+{result.stats.additions}</span>{' '}
          <span className="git-del">−{result.stats.deletions}</span> · ⏱ {result.durationMs} ms
        </span>
        <button type="button" className="btn btn-ghost" onClick={() => void handleRefresh()}>
          🔄 刷新
        </button>
      </div>

      {result.changes.length === 0 && (
        <div className="structure-note">
          🌿 这儿干净着呢 —— 所有改动都已经提交存档了,没有新账要翻。
          <br />
          想看看它怎么干活?随手改一个文件保存(加行注释就行),再点上面的「🔄 刷新」,马上给你讲它改了啥。
        </div>
      )}

      {result.changes.length > 0 && (
        <div className="git-report">
          <div className="explain-head">
            <span className="explain-title">🧾 AI 干活报告</span>
            <button type="button" className="btn" onClick={() => void handleReport()} disabled={reporting}>
              {reporting ? '⏳ 审计官翻账中……' : report?.status === 'supported' ? '🔄 再审一遍' : '🤖 生成本轮报告'}
            </button>
          </div>
          <p className="git-report-hint">不用读一行代码:审计官把这轮改动翻成大白话 —— 干了什么、账对不对、要不要细看。</p>
          {reporting &&
            (reportStream ? (
              <div className="explain-text">
                ✨ {reportStream}
                <span className="stream-caret">▌</span>
              </div>
            ) : (
              <div className="explain-note">
                <ProgressDots />正在翻账本、对线索……(改动多时会慢一点)
              </div>
            ))}
          {!reporting && report?.status === 'supported' && <div className="explain-text">✨ {report.text}</div>}
          {!reporting && report?.status === 'error' && <Notice kind="error">⚠️ {report.text}</Notice>}
        </div>
      )}

      <div className="git-list">
        {result.changes.map((change) => (
          <button
            key={`${change.relPath}:${change.kind}`}
            type="button"
            className={`git-row${selected?.relPath === change.relPath ? ' is-selected' : ''}`}
            onClick={() => {
              setSelected(change)
              setExplain(null)
              // 上一份讲解还在路上就点了别的文件:掐掉它,别让 A 的答案挂到 B 头上,也别占着模型
              if (explaining) {
                cancelExplain(idRef.current)
                idRef.current = ''
                setExplaining(false)
                setStreamText('')
              }
            }}
            title={change.relPath}
          >
            <span className={`git-badge git-badge--${change.kind}`}>{KIND_LABEL[change.kind]}</span>
            <span className="git-path">{change.relPath}</span>
            {change.staged && change.kind !== 'untracked' && <span className="git-staged">已暂存</span>}
            <StatLine add={change.additions} del={change.deletions} />
          </button>
        ))}
      </div>

      {selected && (
        <div className="explain">
          <div className="explain-head">
            <span className="explain-title">
              💬 「{selected.relPath}」这次改了啥
            </span>
            <button type="button" className="btn" onClick={handleExplain} disabled={explaining}>
              {explaining ? '⏳ 模型思考中……' : '🤖 用人话讲讲这个改动'}
            </button>
          </div>
          <button type="button" className="structure-note chip-link" onClick={() => onJump(selected.relPath)}>
            ↗ 在地图里打开这个文件
          </button>
          {explaining && (streamText ? (
            <div className="explain-text">✨ {streamText}<span className="stream-caret">▌</span></div>
          ) : (
            <div className="explain-note"><ProgressDots />正在把改动翻译成人话……(diff 长的话会慢一点)</div>
          ))}
          {!explaining && explain?.status === 'supported' && <div className="explain-text">✨ {explain.text}</div>}
          {!explaining && explain?.status === 'error' && <Notice kind="error">⚠️ {explain.text}</Notice>}
        </div>
      )}
    </div>
  )
}
