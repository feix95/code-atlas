import type { DepGraphResult, FileStructure, ScanFileNode } from '@shared/types'
import { AiAssistCard } from './AiAssist'
import { FILE_PRESETS, type AiAssistApi } from '../useAiAsk'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

/**
 * 文件「概览」Tab:全是选中那一下就到手的静态信息(结构统计、关系数字),
 * 一眼能看懂这文件是干嘛的;AI 卡片只给入口,不自动开跑。
 */
export function FileOverview({
  file,
  structure,
  analyzing,
  analyzeNote,
  graph,
  ai,
  onGoChat
}: {
  file: ScanFileNode
  structure: FileStructure | null
  analyzing: boolean
  analyzeNote: { text: string; kind: 'info' | 'error' } | null
  graph: DepGraphResult | null
  ai: AiAssistApi
  /** 给了就在 AI 卡上显示「去追问」,跳到自由对话 Tab */
  onGoChat?: () => void
}): React.JSX.Element {
  const relNode = graph?.nodes.find((n) => n.relPath === file.relPath)
  const count = (arr: string[] | undefined): number => arr?.length ?? 0

  return (
    <>
      <div className="section-label">
        文件概览 <span>静态分析 · 选中即得,不劳烦模型</span>
      </div>
      <section className="card">
        <p className="card-text">
          <strong>{file.name}</strong>
          {file.summary ? (
            <> —— {file.summary.text}</>
          ) : (
            <>
              是一个{file.language ? `${file.language.name}` : '类型没认出来'}的文件
            </>
          )}
          {file.ext && <span className="chip chip-muted mono">{file.ext}</span>}
        </p>
        {analyzing && (
          <p className="card-waiting">
            <ProgressDots />
            正在解析结构骨架……
          </p>
        )}
        {!analyzing && analyzeNote && analyzeNote.kind === 'error' && <Notice kind="error">{analyzeNote.text}</Notice>}
        {!analyzing && analyzeNote && analyzeNote.kind === 'info' && <p className="card-waiting">{analyzeNote.text}</p>}
        {!analyzing && structure && (
          <div className="metric-grid">
            <div className="metric">
              <strong>{count(structure.functions)}</strong>
              <span>函数</span>
            </div>
            <div className="metric">
              <strong>{count(structure.classes)}</strong>
              <span>类</span>
            </div>
            <div className="metric">
              <strong>{count(structure.interfaces)}</strong>
              <span>接口/类型</span>
            </div>
            <div className="metric">
              <strong>{count(structure.reactComponents)}</strong>
              <span>React 组件</span>
            </div>
            {relNode && (
              <>
                <div className="metric">
                  <strong>{relNode.inCount}</strong>
                  <span>被引用(影响范围)</span>
                </div>
                <div className="metric">
                  <strong>{relNode.outCount}</strong>
                  <span>引用了别人</span>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <AiAssistCard
        ai={ai}
        presets={FILE_PRESETS}
        idleText="不自动打断你的浏览。点按钮或挑一个问题,AI 才开始分析当前文件。"
        mainLabel="解释这个文件"
        onGoChat={onGoChat}
      />
    </>
  )
}
