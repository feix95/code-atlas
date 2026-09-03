import { useEffect, useRef, useState } from 'react'
import type { AiExplainResult, GitChange, GitChangesResult } from '@shared/types'
import { friendlyErr } from '../errText'

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

// git 修改卡:点开自动收一遍改动清单,点文件行选中,再让本地模型用人话讲这个改动。
// 路径契约由主进程保证,这里只递 (rootPath, relPath)。
export function GitChanges({ rootPath, onJump }: { rootPath: string; onJump: (relPath: string) => void }): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<GitChangesResult | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [selected, setSelected] = useState<GitChange | null>(null)
  const [explain, setExplain] = useState<AiExplainResult | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [streamText, setStreamText] = useState('')
  const idRef = useRef('')

  // 订阅 AI 流式增量:只认自己这次请求的 id;组件卸载时退订,防止泄漏监听
  useEffect(() => {
    return window.atlas.onAiDelta((payload) => {
      if (payload.id === idRef.current) setStreamText((prev) => prev + payload.text)
    })
  }, [])

  // 挂载/换文件夹时自动收一遍;setState 都发生在 await 之后,不在 effect 里同步触发。
  // cancelled 守卫:慢响应回来时文件夹已经换了,不许旧账盖新账
  useEffect(() => {
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
    try {
      const r = await window.atlas.gitChanges(rootPath)
      setResult(r)
      setSelected(null)
      setExplain(null)
    } catch (err) {
      setNote(friendlyErr(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleExplain(): Promise<void> {
    if (!selected) return
    setExplaining(true)
    setExplain(null)
    setStreamText('')
    idRef.current = crypto.randomUUID()
    try {
      // 路径契约:只递 relPath,diff 由主进程现场重取,前端传不了假货
      const res = await window.atlas.gitExplainChange(rootPath, selected.relPath, idRef.current)
      setExplain(res)
    } catch (err) {
      setExplain({ status: 'error', text: friendlyErr(err), model: '', durationMs: 0 })
    } finally {
      setExplaining(false)
    }
  }

  if (loading) return <div className="structure-note">⏳ 正在翻 git 的账本,看看谁动了代码……</div>
  if (note) return <div className="structure-note is-error">⚠️ {note}</div>
  if (!result) return <div className="structure-note">git 的账本还没递过来,点一下「🔄 刷新」再试一次?</div>

  if (!result.isGitRepo) {
    return (
      <div className="structure-note">
        这个文件夹还不是 git 仓库,git 还没开始给它记账。
        <br />
        两个办法:① 选项目根目录(里面有 .git 隐藏文件夹的那层);② 或者在项目里跑一次 <code>git init</code>(先跟项目主人打个招呼哦)。
      </div>
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

      <div className="git-list">
        {result.changes.map((change) => (
          <button
            key={`${change.relPath}:${change.kind}`}
            type="button"
            className={`git-row${selected?.relPath === change.relPath ? ' is-selected' : ''}`}
            onClick={() => {
              setSelected(change)
              setExplain(null)
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
            <div className="explain-note">正在把改动翻译成人话……(diff 长的话会慢一点)</div>
          ))}
          {!explaining && explain?.status === 'supported' && <div className="explain-text">✨ {explain.text}</div>}
          {!explaining && explain?.status === 'error' && <div className="explain-note is-error">⚠️ {explain.text}</div>}
        </div>
      )}
    </div>
  )
}
