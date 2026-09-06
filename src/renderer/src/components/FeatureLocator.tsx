import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { FeatureLocateResult, ScanDirNode, ScanTreeNode } from '@shared/types'
import { friendlyErr } from '../errText'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

/** 示例问法点了直接发;挑的是各类项目都通用的三问 */
const LOCATE_EXAMPLES = ['程序从哪个文件启动', '配置写在哪个文件', '界面代码在哪']

/** 在树里找节点(文件/目录都算):给命中的文件卡挂语言徽章用,找不到不硬挂 */
function findNode(node: ScanTreeNode, relPath: string): ScanTreeNode | null {
  if (node.relPath === relPath) return node
  if (node.type !== 'directory') return null
  for (const child of node.children) {
    const hit = findNode(child, relPath)
    if (hit) return hit
  }
  return null
}

/**
 * 功能定位(第六十七锤):「功能在哪」—— 输入一句想知道的事,带路人照着项目地图
 * 指路(地址已过主进程防编造校验),文件卡一点直达;指不出来老实说,不硬凑。
 * 换项目靠 App 给整卡重挂(key=rootPath)清场,组件内不操心换项目。
 */
export function FeatureLocator({
  tree,
  onJump
}: {
  tree: ScanDirNode
  onJump: (relPath: string) => void
}): React.JSX.Element {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FeatureLocateResult | null>(null)
  const idRef = useRef('')

  // 卸载(换选中/关详情)时把还在路上的请求掐掉,别占着模型
  useEffect(() => {
    return () => {
      if (idRef.current) void window.atlas.aiCancel(idRef.current)
    }
  }, [])

  async function ask(q: string): Promise<void> {
    const questionText = q.trim()
    if (!questionText || busy) return
    const requestId = crypto.randomUUID()
    idRef.current = requestId
    setBusy(true)
    setResult(null)
    try {
      // 树由主进程现摊成地图喂模型;指回来的地址已过防编造校验,这里只管画卡片
      const res = await window.atlas.locateFeature(tree, questionText, requestId)
      if (idRef.current !== requestId) return
      setResult(res)
    } catch (err) {
      if (idRef.current !== requestId) return
      setResult({ status: 'error', hits: [], text: friendlyErr(err), model: '', durationMs: 0 })
    } finally {
      if (idRef.current === requestId) {
        setBusy(false)
        idRef.current = ''
      }
    }
  }

  function submit(e: FormEvent): void {
    e.preventDefault()
    void ask(question)
  }

  return (
    <>
      <div className="section-label">
        功能在哪 <span>带路人照着地图指路 · 指的地址都验过真伪</span>
      </div>
      <section className="card">
        <form className="locator-form" onSubmit={submit}>
          <input
            type="text"
            value={question}
            placeholder="想知道什么功能在哪?比如:程序从哪个文件启动"
            aria-label="描述你要找的功能"
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>
            {busy ? '带路中……' : '带我去'}
          </button>
        </form>
        {!busy && !result && (
          <div className="locator-examples">
            {LOCATE_EXAMPLES.map((q) => (
              <button key={q} type="button" className="chip chip-muted" onClick={() => void ask(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        {busy && (
          <div className="card-waiting">
            <ProgressDots />
            带路人正在翻地图……
          </div>
        )}
        {!busy && result?.status === 'supported' && (
          <div className="locator-hits">
            {result.hits.map((hit) => {
              const node = findNode(tree, hit.relPath)
              return (
                <button key={hit.relPath} type="button" className="locator-hit" onClick={() => onJump(hit.relPath)} title="在地图里打开">
                  <span className="locator-hit-top">
                    <span className="locator-hit-path mono">{hit.relPath}</span>
                    {node?.type === 'file' && node.language && <span className="chip chip-muted">{node.language.name}</span>}
                  </span>
                  <span className="locator-hit-reason">{hit.reason}</span>
                </button>
              )
            })}
            <p className="rec-footnote">指路是带路人的推测 —— 点卡片直接去那个文件;想接着细问,去「自由对话」。</p>
          </div>
        )}
        {!busy && result?.status === 'error' && <Notice kind="error">⚠️ {result.text}</Notice>}
        {!busy && result && (result.status === 'unsupported' || result.status === 'cancelled') && (
          <p className="card-text">{result.text}</p>
        )}
      </section>
    </>
  )
}
