// 页签正文的房间分配:概览(文件/文件夹/项目)/小探针对话/代码预览,按页签品类各就各位。
// 钉住的概览定死在节点上,跟随的概览跟树里选中走;钉住的对话自带账本,只藏不拆。
import { useMemo } from 'react'
import type {
  ChatCodeRef,
  ChatContextAttachment,
  DepGraphResult,
  FileStructure,
  GitChangesResult,
  ScanDirNode,
  ScanFileNode,
  ScanResult
} from '@shared/types'
import type { FileLinkTarget } from '@shared/fileLinks'
import { CODE_REFS_MAX } from '@shared/aiDefaults'
import type { NoteEntry, NoteMap } from '@shared/notes'
import { buildFileAttachment, buildFolderAttachment } from '../chatContext'
import { buildCrumbs, findDir, findFile } from '../scanTreeTools'
import type { PaneTab } from '../paneTabs'
import { useAiAsk, type AiTurn } from '../useAiAsk'
import { useAiChat, type AiChatApi } from '../useAiChat'
import { usePresetQuestions } from '../usePresetQuestions'
import { DetailHeader } from './DetailHeader'
import { FileOverview } from './FileOverview'
import { FolderOverview } from './FolderOverview'
import { FreeChatPanel } from './FreeChatPanel'
import { CodePreview } from './CodePreview'
import { ProjectOverview } from './ProjectOverview'

export function TabBody({
  tab,
  result,
  notes,
  noteEditRequest,
  previewRefs,
  previewJump,
  selectedFile,
  selectedFolder,
  structure,
  analyzing,
  analyzeNote,
  graph,
  graphLoading,
  graphNote,
  gitInfo,
  setGitInfo,
  gitLoading,
  chatSuggestionsOn,
  chat,
  chatContext,
  fileLinks,
  goAskInChat,
  handleLoadGraph,
  jumpTo,
  saveNote,
  editNoteFromTree,
  openPreview,
  closeTab,
  addPreviewRef,
  removePreviewRef,
  handleDropNode
}: {
  tab: PaneTab
  result: ScanResult
  notes: NoteMap
  noteEditRequest: string | null
  previewRefs: ChatCodeRef[]
  previewJump: { line: number; seq: number } | null
  selectedFile: ScanFileNode | null
  selectedFolder: ScanDirNode | null
  structure: FileStructure | null
  analyzing: boolean
  analyzeNote: { text: string; kind: 'info' | 'error' } | null
  graph: DepGraphResult | null
  graphLoading: boolean
  graphNote: string | null
  gitInfo: GitChangesResult | null
  setGitInfo: React.Dispatch<React.SetStateAction<GitChangesResult | null>>
  gitLoading: boolean
  chatSuggestionsOn: boolean
  chat: AiChatApi
  chatContext: ChatContextAttachment | null
  fileLinks: FileLinkTarget | null
  goAskInChat: (node: ScanFileNode | ScanDirNode | null, turn: AiTurn | null) => void
  handleLoadGraph: () => Promise<void>
  jumpTo: (relPath: string) => void
  saveNote: (relPath: string, text: string) => void
  editNoteFromTree: (relPath: string) => void
  openPreview: (relPath: string) => void
  closeTab: (id: string) => void
  addPreviewRef: (ref: ChatCodeRef) => void
  removePreviewRef: (index: number) => void
  handleDropNode: (kind: 'file' | 'folder', relPath: string) => Promise<void>
}): React.JSX.Element | null {
  if (!result) return null
  const file = tab.relPath !== '' ? findFile(result.tree, tab.relPath) : null
  if (tab.kind === 'overview') {
    if (tab.pinned) {
      // 钉住的概览:定在 pin 时的那个节点上(空槽 = 项目主页也照钉);节点没了退回主页,不装死
      if (tab.relPath !== '' && file) {
        return (
          <FileOverviewPage
            key={tab.id}
            file={file}
            result={result}
            structure={tab.relPath === selectedFile?.relPath ? structure : null}
            analyzing={tab.relPath === selectedFile?.relPath && analyzing}
            analyzeNote={tab.relPath === selectedFile?.relPath ? analyzeNote : null}
            graph={graph}
            graphLoading={graphLoading}
            graphNote={graphNote}
            onLoadGraph={() => void handleLoadGraph()}
            onJump={jumpTo}
            gitInfo={gitInfo}
            gitLoading={gitLoading}
            note={notes[file.relPath] ?? null}
            onNoteSave={saveNote}
            autoOpenNote={noteEditRequest === file.relPath}
            suggestionsOn={chatSuggestionsOn}
            onGoChat={(turn) => goAskInChat(file, turn)}
            onPreview={() => openPreview(file.relPath)}
          />
        )
      }
      const dir = tab.relPath !== '' && result ? findDir(result.tree, tab.relPath) : null
      if (dir) {
        return (
          <FolderOverviewPage
            key={tab.id}
            dir={dir}
            result={result}
            gitInfo={gitInfo}
            onJump={jumpTo}
            onRefreshed={setGitInfo}
            note={notes[dir.relPath] ?? null}
            onNoteSave={saveNote}
            autoOpenNote={noteEditRequest === dir.relPath}
            onGoChat={(turn) => goAskInChat(dir, turn)}
          />
        )
      }
      return (
        <ProjectOverview
          key={tab.id}
          result={result}
          graph={graph}
          graphLoading={graphLoading}
          graphNote={graphNote}
          onLoadGraph={() => void handleLoadGraph()}
          onJump={jumpTo}
          onReadFile={openPreview}
          gitInfo={gitInfo}
          onRefreshed={setGitInfo}
        />
      )
    }
    // 跟随概览:左侧树选中谁就显示谁的概览;什么都没选 = 项目主页(概览页签的零状态)
    if (selectedFolder) {
      return (
        <FolderOverviewPage
          key={selectedFolder.relPath || '(root)'}
          dir={selectedFolder}
          result={result}
          gitInfo={gitInfo}
          onJump={jumpTo}
          onRefreshed={setGitInfo}
          note={notes[selectedFolder.relPath] ?? null}
          onNoteSave={saveNote}
          autoOpenNote={noteEditRequest === selectedFolder.relPath}
          onGoChat={(turn) => goAskInChat(selectedFolder, turn)}
        />
      )
    }
    if (selectedFile) {
      return (
        <FileOverviewPage
          key={selectedFile.relPath}
          file={selectedFile}
          result={result}
          structure={structure}
          analyzing={analyzing}
          analyzeNote={analyzeNote}
          graph={graph}
          graphLoading={graphLoading}
          graphNote={graphNote}
          onLoadGraph={() => void handleLoadGraph()}
          onJump={jumpTo}
          gitInfo={gitInfo}
          gitLoading={gitLoading}
          note={notes[selectedFile.relPath] ?? null}
          onNoteSave={saveNote}
          autoOpenNote={noteEditRequest === selectedFile.relPath}
          suggestionsOn={chatSuggestionsOn}
          onGoChat={(turn) => goAskInChat(selectedFile, turn)}
          onPreview={() => openPreview(selectedFile.relPath)}
        />
      )
    }
    return (
      <ProjectOverview
        key={result.rootPath}
        result={result}
        graph={graph}
        graphLoading={graphLoading}
        graphNote={graphNote}
        onLoadGraph={() => void handleLoadGraph()}
        onJump={jumpTo}
        onReadFile={openPreview}
        gitInfo={gitInfo}
        onRefreshed={setGitInfo}
      />
    )
  }
  if (tab.kind === 'chat') {
    // 公用对话场:所有文件聊天都在这一场里,除非主动开新对话(第一百二十四锤的老规矩)
    // (小探针飞出时这张页签连卡带正房一起隐去,走不到这儿 —— 见渲染处 act 判定)
    return (
      <div className="preview-chat soft-in">
        <FreeChatPanel
          chat={chat}
          context={chatContext}
          refs={previewRefs}
          onRemoveRef={removePreviewRef}
          onDropNode={handleDropNode}
          fileLinks={fileLinks}
          suggestionsOn={chatSuggestionsOn}
        />
      </div>
    )
  }
  // 预览页签:纯源码窗(小葵拍板的拆分) —— 想边看代码边聊,把探针页签拖去另一组拼一屏
  if (file) {
    return (
      <CodePreview
        key={tab.id}
        rootPath={result.rootPath}
        file={file}
        canAddRef={previewRefs.length < CODE_REFS_MAX}
        refLimit={CODE_REFS_MAX}
        onAddRef={addPreviewRef}
        onClose={() => closeTab(tab.id)}
        jump={previewJump}
        noteMenu={{
          hasNote: notes[file.relPath] !== undefined,
          onEdit: () => editNoteFromTree(file.relPath),
          onRemove: () => saveNote(file.relPath, '')
        }}
      />
    )
  }
  return (
    <div className="pane-hint">
      {tab.relPath === ''
        ? '在左侧文件树双击一个文件,代码就在这儿看'
        : '这个文件不在树里了(可能被删了或改名了),双击树里的文件换一个看'}
    </div>
  )
}

/**
 * 概览页签的正文(文件版):讲解卡 + 结构清单 + 关系卡,头顶一条轻头部(面包屑/徽章/备注)。
 * 内页 Tab 已退役 —— 「聊天」是独立的品类页签,概览想聊天就喊一声把探针页签点亮。
 * key = 页签/文件身份:换文件整个重挂,AI 助手跟着换目标,旧请求就地取消。
 */
export function FileOverviewPage({
  file,
  result,
  structure,
  analyzing,
  analyzeNote,
  graph,
  graphLoading,
  graphNote,
  onLoadGraph,
  onJump,
  gitInfo,
  gitLoading,
  note,
  onNoteSave,
  autoOpenNote,
  suggestionsOn,
  onGoChat,
  onPreview
}: {
  file: ScanFileNode
  result: ScanResult
  structure: FileStructure | null
  analyzing: boolean
  analyzeNote: { text: string; kind: 'info' | 'error' } | null
  graph: DepGraphResult | null
  graphLoading: boolean
  graphNote: string | null
  onLoadGraph: () => void
  /** 关系卡跳转 */
  onJump: (relPath: string) => void
  gitInfo: GitChangesResult | null
  gitLoading: boolean
  /** 小葵的手动备注(第九十八锤) */
  note: NoteEntry | null
  onNoteSave: (relPath: string, text: string) => void
  /** 树上右键「写/编辑备注」:头部自动展开编辑框 */
  autoOpenNote?: boolean
  /** 推荐问题总闸(设置里的「推荐问题」):关了概览 AI 卡不出预设题,烧模型的预测也一并歇 */
  suggestionsOn: boolean
  /** 「去追问」:点亮 Atlas 小探针页签,并把卡里解释好的一轮带上,那边接着往下问 */
  onGoChat: (turn: AiTurn | null) => void
  onPreview: () => void
}): React.JSX.Element {
  // AI 解释:概览卡,证据优先的单问单答,绝不自动开跑
  const ai = useAiAsk((requestId, question) =>
    window.atlas.aiExplainFile(
      result.rootPath,
      file.relPath,
      file.language?.id ?? '',
      requestId,
      question ?? undefined,
      note?.text
    )
  )
  // 预设问题三层预测(第一百零九锤):规则秒出,AI 按文件证据定制,失败不惊动;总闸关了全歇
  const presets = usePresetQuestions({
    rootPath: result.rootPath,
    file,
    note: note?.text,
    enabled: suggestionsOn,
    allowAi: ai.turns.some((turn) => turn.state === 'done')
  })

  const crumbs = buildCrumbs(result.rootName, result.rootPath, file.relPath)
  const gitChange = gitInfo?.changes.find((c) => c.relPath === file.relPath)
  const badges: Array<{ label: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'muted' }> = []
  if (file.language) badges.push({ label: file.language.name, tone: 'blue' })
  if (gitChange) {
    const tone =
      gitChange.kind === 'deleted' ? 'red' : gitChange.kind === 'added' ? 'green' : 'blue'
    const label: Record<string, string> = {
      added: 'git 新增',
      modified: 'git 修改',
      deleted: 'git 删除',
      renamed: 'git 重命名',
      untracked: 'git 新文件'
    }
    badges.push({ label: label[gitChange.kind], tone })
  } else if (gitInfo && !gitLoading) {
    badges.push({ label: '无未提交改动', tone: 'muted' })
  }

  return (
    <div className="detail-page">
      <DetailHeader
        crumbs={crumbs}
        iconName={file.summary?.icon ?? 'file'}
        title={file.name}
        subtitle={file.summary?.text ?? (file.language ? `${file.language.name} 文件` : '文件')}
        note={note}
        onNoteSave={(text) => onNoteSave(file.relPath, text)}
        autoOpenNote={autoOpenNote}
        badges={badges}
      />
      <div className="detail-body">
        <FileOverview
          file={file}
          noteText={note?.text}
          presets={presets.questions}
          structure={structure}
          analyzing={analyzing}
          analyzeNote={analyzeNote}
          graph={graph}
          graphLoading={graphLoading}
          graphNote={graphNote}
          onLoadGraph={onLoadGraph}
          ai={ai}
          onGoChat={onGoChat}
          onJump={onJump}
          onPreview={onPreview}
        />
      </div>
    </div>
  )
}

/** 概览页签的正文(文件夹版):静态目录概览为主,讲解卡在页面里;聊天是独立的品类页签 */
export function FolderOverviewPage({
  dir,
  result,
  gitInfo,
  onJump,
  onRefreshed,
  note,
  onNoteSave,
  autoOpenNote,
  onGoChat
}: {
  dir: ScanDirNode
  result: ScanResult
  gitInfo: GitChangesResult | null
  onJump: (relPath: string) => void
  onRefreshed: (result: GitChangesResult) => void
  /** 小葵的手动备注(第九十八锤) */
  note: NoteEntry | null
  onNoteSave: (relPath: string, text: string) => void
  /** 树上右键「写/编辑备注」:头部自动展开编辑框 */
  autoOpenNote?: boolean
  /** 「去追问」:点亮 Atlas 小探针页签,并把卡里解释好的一轮带上,那边接着往下问 */
  onGoChat: (turn: AiTurn | null) => void
}): React.JSX.Element {
  const ai = useAiAsk((requestId, question) =>
    window.atlas.aiExplainFolder(result.rootPath, dir.relPath, requestId, question ?? undefined)
  )

  const badges: Array<{ label: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'muted' }> = []
  if (dir.relPath === '') badges.push({ label: '项目根', tone: 'blue' })
  if (dir.lazy) badges.push({ label: '未扫描', tone: 'amber' })
  else if (dir.truncated) badges.push({ label: '不完整', tone: 'amber' })
  else badges.push({ label: '已扫描', tone: 'green' })

  return (
    <div className="detail-page">
      <DetailHeader
        crumbs={buildCrumbs(result.rootName, result.rootPath, dir.relPath)}
        iconName="folder"
        title={dir.name || result.rootName}
        subtitle={dir.summary?.text ?? '文件夹'}
        note={note}
        onNoteSave={(text) => onNoteSave(dir.relPath, text)}
        autoOpenNote={autoOpenNote}
        badges={badges}
      />
      <div className="detail-body">
        <FolderOverview
          dir={dir}
          noteText={note?.text}
          ai={ai}
          onGoChat={onGoChat}
          gitInfo={gitInfo}
          rootPath={result.rootPath}
          onJump={onJump}
          onRefreshed={onRefreshed}
        />
      </div>
    </div>
  )
}

/**
 * 钉住的对话页签正文:pin 那一刻从公用场分家出来的独立账本(出生自带当时的记录),
 * 上下文也定死在 pin 时的节点上 —— 树里换文件,这页对话纹丝不动。
 * 它住在保活层里(只藏不拆),关掉页签才是这场对话的终点。
 */
export function PinnedChatPane({
  tab,
  result,
  refs,
  onRemoveRef,
  onDropNode,
  fileLinks,
  suggestionsOn
}: {
  tab: PaneTab
  result: ScanResult
  refs: ChatCodeRef[]
  onRemoveRef: (index: number) => void
  onDropNode?: (kind: 'file' | 'folder', relPath: string) => void
  fileLinks?: FileLinkTarget | null
  suggestionsOn: boolean
}): React.JSX.Element {
  // 上下文定死在 pin 时的节点:文件在就是文件附件,文件夹/项目根就是文件夹附件,没了就空着
  const context = useMemo(() => {
    const f = tab.relPath === '' ? null : findFile(result.tree, tab.relPath)
    if (f) return buildFileAttachment(f, null)
    const d = tab.relPath === '' ? result.tree : findDir(result.tree, tab.relPath)
    if (d) return buildFolderAttachment(d, d.name || result.rootName)
    return null
  }, [result, tab.relPath])
  const chat = useAiChat(context, result.rootPath, tab.seed)

  return (
    <div className="preview-chat soft-in">
      <FreeChatPanel
        chat={chat}
        context={context}
        refs={refs}
        onRemoveRef={onRemoveRef}
        onDropNode={onDropNode}
        fileLinks={fileLinks}
        suggestionsOn={suggestionsOn}
      />
    </div>
  )
}

/** 页签全关光时的底板:大 logo + 一句指路(页签栏还在,右键空白处能勾回来) */
export function PaneEmptyBoard(): React.JSX.Element {
  return (
    <div className="pane-empty">
      <span className="pane-empty-mark" aria-hidden="true">
        ⌁
      </span>
      <p className="pane-empty-title">页签都关掉了</p>
      <p className="pane-empty-hint">
        在左侧文件树点一个文件就能打开;想勾回功能页,在页签栏空白处右键
      </p>
    </div>
  )
}
