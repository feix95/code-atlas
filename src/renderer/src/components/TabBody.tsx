// 页签正文的房间分配:自由对话/代码预览/图谱/设置/瞄一眼,按页签品类各就各位。
// 文件签天生钉在自己的文件上,关掉签就是它的终点。
import type {
  AiConfig,
  ChatCodeRef,
  DepGraphResult,
  ScanDirNode,
  ScanFileNode,
  ScanResult
} from '@shared/types'
import type { FileLinkTarget } from '@shared/fileLinks'
import type { RenameOutcome } from '@shared/fileRename'
import { CODE_REFS_MAX } from '@shared/aiDefaults'
import { findFile } from '../scanTreeTools'
import type { PaneTab } from '../paneTabs'
import type { AiChatApi } from '../useAiChat'
import { FreeChatPanel } from './FreeChatPanel'
import { CodePreview } from './CodePreview'
import { SettingsPage, type SectionKey } from './SettingsPage'
import { GraphView } from './GraphView'
import { UiWorkbench } from './uiWorkbench/UiWorkbench'
import { TranslationView } from './TranslationView'

export function TabBody({
  tab,
  result,
  previewRefs,
  previewJump,
  graph,
  graphLoading,
  graphNote,
  chat,
  fileLinks,
  handleLoadGraph,
  expandLazy,
  openPreview,
  addPreviewRef,
  removePreviewRef,
  handleDropRef,
  settingsWorkspaceName,
  settingsSectionReq,
  onAiConfigSaved,
  onSettingsSection,
  onRenameFile
}: {
  tab: PaneTab
  result: ScanResult | null
  previewRefs: ChatCodeRef[]
  previewJump: { line: number; seq: number } | null
  graph: DepGraphResult | null
  graphLoading: boolean
  graphNote: string | null
  chat: AiChatApi
  fileLinks: FileLinkTarget | null
  handleLoadGraph: () => Promise<void>
  /** 按需扫描 lazy 目录(App 的 handleExpandLazy),关系图谱进入未扫描目录时用 */
  expandLazy: (relPath: string) => Promise<ScanDirNode | null>
  openPreview: (relPath: string) => void
  addPreviewRef: (ref: ChatCodeRef) => void
  removePreviewRef: (index: number) => void
  /** 预览里选中的一段拖进来挂引用:ref 正文自包含,不用读盘 */
  handleDropRef: (ref: ChatCodeRef) => void
  // 设置页签的口粮(app 级,不吃工作区):rail 齿轮/AI 状态浮层都能开,没开项目也能用
  settingsWorkspaceName: string | null
  settingsSectionReq: { section: SectionKey; seq: number } | undefined
  onAiConfigSaved: (config: AiConfig) => void
  /** 设置页滚动间谍回报(App 转发给侧栏导航高亮) */
  onSettingsSection: (key: SectionKey) => void
  /** 内联标题改名通道:预览/瞄签都能用,状态表认签认 scopeRoot */
  onRenameFile?: (tab: PaneTab, base: string) => Promise<RenameOutcome>
}): React.JSX.Element | null {
  // 菜单外单例签不吃工作区(没开项目 rail 上照样能点出来),先拦在 result 闸之前
  // 盘符下钻的「瞄一眼」预览(UI v3 §7.1):读根记在页签上(scopeRoot = 浏览树的盘根),
  // 文件节点是浏览账上现捏的最小件 —— CodePreview 照旧走 joinRoot 路径契约读盘
  if (tab.kind === 'peek') {
    if (!tab.scopeRoot) return null
    const name = tab.relPath.split('/').pop() ?? tab.relPath
    const dot = name.lastIndexOf('.')
    const file: ScanFileNode = {
      type: 'file',
      name,
      relPath: tab.relPath,
      ext: dot > 0 ? name.slice(dot).toLowerCase() : ''
    }
    return (
      <CodePreview
        key={tab.id}
        rootPath={tab.scopeRoot}
        file={file}
        canAddRef={false}
        refLimit={0}
        onAddRef={() => {}}
        onRenameFile={onRenameFile ? (base) => onRenameFile(tab, base) : undefined}
      />
    )
  }
  // 关系图谱:资源管理器的图形视图,规格见 docs/archive《关系图谱-实施方案.md》
  if (tab.kind === 'graph') {
    return (
      <GraphView
        result={result}
        graph={graph}
        graphLoading={graphLoading}
        graphNote={graphNote}
        onLoadGraph={() => void handleLoadGraph()}
        expandLazy={expandLazy}
        onOpenFile={openPreview}
      />
    )
  }
  // 设置页:UI v3 §6 弹窗退役改页签;关签 = 页签带的 ×(页内无页脚,即改即存无账要结)
  if (tab.kind === 'settings') {
    return (
      <SettingsPage
        workspaceName={settingsWorkspaceName}
        sectionReq={settingsSectionReq}
        onAiConfigSaved={onAiConfigSaved}
        onSettingsSection={onSettingsSection}
      />
    )
  }
  // UI 工作台:不吃工作区,和设置一样拦在 result 闸之前
  if (tab.kind === 'uiworkbench') return <UiWorkbench />
  // 自由对话同样拦在 result 闸之前:没开工作区也能聊,只是不带项目里的文件上下文
  if (tab.kind === 'chat') {
    // 公用对话场:所有文件聊天都在这一场里,除非主动开新对话(的老规矩)
    // (小探针飞出时这张页签连卡带页签活 DOM一起隐去,走不到这儿 —— 见渲染处 act 判定)
    return (
      <div className="preview-chat soft-in">
        <FreeChatPanel
          chat={chat}
          refs={previewRefs}
          onRemoveRef={removePreviewRef}
          onDropRef={handleDropRef}
          rootPath={result?.rootPath}
          fileLinks={fileLinks}
        />
      </div>
    )
  }
  if (!result) return null
  // 翻译镜像签:虚拟内容,读根仍是当前工作区;只读,不落盘
  if (tab.kind === 'translate') {
    return (
      <TranslationView
        key={tab.id}
        rootPath={result.rootPath}
        relPath={tab.relPath}
        lang={tab.lang ?? 'zh-CN'}
      />
    )
  }
  const file = tab.relPath !== '' ? findFile(result.tree, tab.relPath) : null
  // 预览页签:纯源码窗(产品裁定的拆分) —— 想边看代码边聊,把探针页签拖去另一组拼一屏
  if (file) {
    return (
      <CodePreview
        key={tab.id}
        rootPath={result.rootPath}
        file={file}
        canAddRef={previewRefs.length < CODE_REFS_MAX}
        refLimit={CODE_REFS_MAX}
        onAddRef={addPreviewRef}
        jump={previewJump}
        fileLinks={fileLinks}
        onRenameFile={onRenameFile ? (base) => onRenameFile(tab, base) : undefined}
      />
    )
  }
  return (
    <div className="pane-hint">
      {tab.relPath === ''
        ? '在左侧文件树点一个文件,代码就在这儿看'
        : '这个文件不在树里了(可能被删了或改名了),点树里的文件换一个看'}
    </div>
  )
}

/** 还没有亮着的页签时的底板:大 logo + 一句指路 */
export function PaneEmptyBoard(): React.JSX.Element {
  return (
    <div className="pane-empty">
      <span className="pane-empty-mark" aria-hidden="true">
        ⌁
      </span>
      <p className="pane-empty-title">还没有打开的页签</p>
      <p className="pane-empty-hint">
        在左侧文件树里点文件或文件夹开始阅读;自由对话、关系图谱、UI 工作台、设置在左侧图标栏开
      </p>
    </div>
  )
}
