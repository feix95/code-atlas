import type { DepGraphResult, FileStructure, ScanFileNode } from '@shared/types'
import { AiAssistCard } from './AiAssist'
import type { AiAssistApi, AiTurn } from '../useAiAsk'
import { FileRelations } from './FileRelations'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'
import { StructureGrid } from './StructureGrid'

/** 六节零件全空的文件(配置/常量/纯数据)连结构卡都不摆,不立空架子 */
function hasStructureParts(structure: FileStructure): boolean {
  return (
    structure.functions.length > 0 ||
    structure.classes.length > 0 ||
    structure.interfaces.length > 0 ||
    structure.reactComponents.length > 0 ||
    structure.exports.length > 0 ||
    structure.imports.length > 0
  )
}

/**
 * 文件「概览」Tab:全是选中那一下就到手的静态信息(结构统计、关系数字),
 * 一眼能看懂这文件是干嘛的;AI 卡片只给入口,不自动开跑。
 * 文件关系住在下面(小葵拍板:原先垫底的「结构与关系」Tab 曝光率太低,
 * 搬进默认页,能看到的就有);旧「结构」Tab 整页退役后,零件清单也搬进来垫底
 * ——冷门内容不占 Tab 位,文件/文件夹详情统一成 概览+小探针 两页。
 * 全项目连线是重活,第一次点按钮才分析,一次全会话记账。
 */
export function FileOverview({
  file,
  noteText,
  presets,
  structure,
  analyzing,
  analyzeNote,
  graph,
  graphLoading,
  graphNote,
  onLoadGraph,
  ai,
  onGoChat,
  onJump
}: {
  file: ScanFileNode
  /** 小葵的手动备注(第九十八锤):给了就盖过引擎一句话 */
  noteText?: string
  /** 预设问题(第一百零九锤:规则打底 + AI 定制预测) */
  presets: string[]
  structure: FileStructure | null
  analyzing: boolean
  analyzeNote: { text: string; kind: 'info' | 'error' } | null
  graph: DepGraphResult | null
  graphLoading: boolean
  graphNote: string | null
  /** 关系还没分析过时,点按钮跑全项目连线分析 */
  onLoadGraph: () => void
  ai: AiAssistApi
  /** 给了就在 AI 卡上显示「去追问」:跳到自由对话 Tab,并把这边解释好的一轮带上 */
  onGoChat?: (turn: AiTurn | null) => void
  /** 关系里点文件跳转(保持当前 Tab,顺着关系链看) */
  onJump: (relPath: string) => void
}): React.JSX.Element {
  const relNode = graph?.nodes.find((n) => n.relPath === file.relPath)
  const count = (arr: string[] | undefined): number => arr?.length ?? 0
  // 旧「结构」Tab 的清单:解析完、真有零件才摆卡
  const showStructure = !analyzing && structure !== null && hasStructureParts(structure)

  return (
    <>
      <div className="section-label">
        文件概览 <span>静态分析 · 选中即得</span>
      </div>
      <section className="card">
        <p className="card-text">
          <strong>{file.name}</strong>
          {noteText ? (
            <> —— {noteText}</>
          ) : file.summary ? (
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
        presets={presets}
        idleText="不自动打断你的浏览。点按钮或挑一个问题,AI 才开始分析当前文件。"
        mainLabel="解释这个文件"
        onGoChat={onGoChat}
      />

      {/* 关系模组:和上面两个卡一个模组相(壳+头),没分析过/分析中也是同款壳,不摆露天标签 */}
      {graph ? (
        <FileRelations relPath={file.relPath} graph={graph} onJump={onJump} />
      ) : (
        <section className="card relation-card">
          <header className="relation-card-head">
            文件关系 <span>谁引用了它、它引用谁、改它会牵连谁</span>
          </header>
          {graphLoading ? (
            <p className="relation-empty-note">
              <ProgressDots />
              正在连线……
            </p>
          ) : (
            <p className="relation-empty-note">
              还没分析过文件关系,点一下跑一遍全项目连线。
              <button type="button" className="btn btn-primary" onClick={onLoadGraph}>
                分析文件关系
              </button>
          {graphNote && <Notice kind="error">{graphNote}</Notice>}
            </p>
          )}
        </section>
      )}

      {/* 结构卡:旧「结构」Tab 搬进来垫底,和关系卡一个模组相(壳+头);
          六节全空的文件(配置/常量)整卡藏掉 */}
      {showStructure && (
        <section className="card relation-card">
          <header className="relation-card-head">
            结构 <span>文件里有哪些函数、类、组件</span>
          </header>
          <StructureGrid structure={structure} />
        </section>
      )}
    </>
  )
}
