/// <reference types="vite/client" />

import type { Appearance } from '../../shared/appearancePrefs.ts'
import type { ChatMessage } from './useAiChat'
import type { ModelDownloadProgress, RepoFile, ShelfResult } from '../../shared/modelShelf.ts'
import type { TavilyProbeResult } from '../../shared/tavily.ts'
import type {
  AiChatLookupPayload,
  AiChatRequest,
  AiChatResult,
  AiCompactRequest,
  AiConfig,
  AiDeltaPayload,
  AiExplainResult,
  DepGraphResult,
  DriveInfo,
  FeatureLocateResult,
  FilePreviewResult,
  FileStructure,
  FreechatHost,
  FreechatInput,
  GitChangesResult,
  ModelContextInfo,
  ModelFitVerdict,
  ModelStatus,
  ScanDirNode,
  ScanResult,
      DevLogEntry
} from '../../shared/types.ts'

declare global {
  interface Window {
    atlas: {
      versions: {
        node: () => string
        chrome: () => string
        electron: () => string
      }
      pickFolder: () => Promise<string | null>
      /** 外观偏好(存主进程 appearance.json):getSync 同步通道保首帧不闪默认皮;save 走 invoke 异步落盘 */
      appearance: {
        getSync: () => Appearance | null
        save: (a: Appearance) => Promise<void>
      }
      /** 列盘符:只问 Windows 有哪些盘,不翻文件内容;首页盘符列表用 */
      listDrives: () => Promise<DriveInfo[]>
      /** CodeAtlas 自身版本号(设置里的版本信息行用) */
      appVersion: () => Promise<string>
      getUiScale: () => number
      setUiScale: (factor: number) => void
      /** 只预览不落盘:改根字号并广播,但不写 localStorage(设置弹窗的暂存预览用) */
      previewUiScale: (factor: number) => void
      windowClose: () => Promise<void>
      windowMinimize: () => Promise<void>
      windowMaximizeToggle: () => Promise<boolean>
      windowIsMaximized: () => Promise<boolean>
      onWindowMaximized: (callback: (maximized: boolean) => void) => () => void
      scanFolder: (folderPath: string) => Promise<ScanResult>
      scanSubdir: (rootPath: string, relPath: string) => Promise<ScanResult>
      analyzeFile: (rootPath: string, relPath: string, languageId: string) => Promise<FileStructure | null>
      /** 代码预览:读一个文件的前一段当文本看(二进制/超大/读不了都有专门的话) */
      readPreview: (rootPath: string, relPath: string) => Promise<FilePreviewResult>
      depGraph: (rootPath: string) => Promise<DepGraphResult>
      /** 模型货架:实时榜(主进程双源拉取,顺带本机家底)+ 仓库文件清单 */
      modelShelf: () => Promise<ShelfResult>
      modelFiles: (repoId: string) => Promise<RepoFile[]>
      /** 一键到位:点文件 → 断点续传下载到 userData/models → 自动填 AI 配置;返回最终路径 */
      modelDownloadStart: (repoId: string, filePath: string) => Promise<string>
      modelDownloadCancel: () => Promise<boolean>
      onModelDownloadProgress: (callback: (p: ModelDownloadProgress) => void) => () => void
      aiConfigGet: () => Promise<AiConfig>
      aiConfigSave: (config: AiConfig) => Promise<AiConfig>
      aiListModels: (baseUrl: string) => Promise<string[]>
      /** Tavily Key 体检(2026-09-17):点「测一下」真打一次官方接口,按状态码给结论;只回结论,不回显 Key */
      aiTestTavily: (key: string) => Promise<TavilyProbeResult>
      aiPickFile: () => Promise<string | null>
      aiExplainFile: (
        rootPath: string,
        relPath: string,
        languageId: string,
        requestId?: string,
        question?: string,
        note?: string
      ) => Promise<AiExplainResult>
      aiExplainFolder: (rootPath: string, relPath: string, requestId?: string, question?: string) => Promise<AiExplainResult>
      aiChat: (req: AiChatRequest) => Promise<AiChatResult>
      /** /compact 手动压缩(第一百四十二锤):把目前为止的对话提炼成摘要 */
      aiCompact: (req: AiCompactRequest) => Promise<AiExplainResult>
      /** 试一句(第一百一十三锤):拿还没保存的个性化草稿念一段,当场听效果 */
      aiStyleSample: (personalization: unknown, requestId?: string) => Promise<AiExplainResult>
      onChatLookup: (callback: (payload: AiChatLookupPayload) => void) => () => void
      gitChanges: (rootPath: string) => Promise<GitChangesResult>
      gitExplainChange: (rootPath: string, relPath: string, requestId?: string) => Promise<AiExplainResult>
      /** AI 干活报告:整轮改动的大白话审计,流式增量走 atlas:ai-delta */
      gitReport: (rootPath: string, requestId?: string) => Promise<AiExplainResult>
      /** 功能定位:扫描树当地图递给主进程,带路人指路(地址已过防编造校验) */
      locateFeature: (tree: ScanDirNode, question: string, requestId?: string) => Promise<FeatureLocateResult>
      aiCancel: (requestId: string) => Promise<void>
      webLookup: (query: string) => Promise<string>
      onAiDelta: (callback: (payload: AiDeltaPayload) => void) => () => void
      /** 模型状态栏(第七十锤):查一次现状;取消热身/卸下模型(仅内置模型有效) */
      modelStatusGet: () => Promise<ModelStatus>
      modelEject: () => Promise<{ ok: boolean; message?: string }>
      /** 右键文件链接复制完整路径:主进程 joinRoot 拼绝对路径写进剪贴板,只复制不打开 */
      copyFilePath: (rootPath: string, relPath: string) => Promise<{ ok: boolean; path?: string; message?: string }>
      /** 右键文件链接「在文件资源管理器中显示」:资源管理器弹出并选中文件,不开文件 */
      revealFilePath: (rootPath: string, relPath: string) => Promise<{ ok: boolean; message?: string }>
      /** 订阅模型状态变化(热身进度/就绪/出岔子);返回退订函数 */
      onModelStatus: (callback: (status: ModelStatus) => void) => () => void
      /** 量尺:模型块头 vs 机器尺寸,选模型那一刻就给结论(绿装得下/黄有点挤/红装不下) */
      modelFitCheck: (modelPath: string) => Promise<ModelFitVerdict>
      /** 模型档案(上下文档位的账本):出厂上限 + 层数头数 + 机器家底;翻不到回 null */
      modelContextInfo: (modelPath: string) => Promise<ModelContextInfo | null>
      /** 救生圈的复活信号:画面断了被主进程重接回来时喊一声;返回退订函数 */
      onRendererRevived: (callback: () => void) => () => void
      /** 报错小纸条:渲染层抓到的 JS 错误送进后台账本 */
      reportRendererError: (text: string) => void
      /** 画面心跳(救生圈2.0):rAF 每秒报一跳;窗露着心跳停了,主进程自动重挂救命 */
      frameHeartbeat: () => void
      /** Developer 日志(第八十七锤):拉旧账 / 清账 / 开窗 / 订阅新账 */
      devLogsPull: () => Promise<DevLogEntry[]>
      devLogsClear: () => Promise<void>
      devLogsOpen: () => Promise<void>
      onDevLog: (callback: (entry: DevLogEntry) => void) => () => void
      /** 桌宠(桌宠托管第二锤):露面状态拉取 + 藏/露订阅 + 拖动三连 + 点击激活 + 右键菜单 */
      mascotVisibilityGet: () => Promise<boolean>
      onMascotVisibility: (fn: (visible: boolean) => void) => () => void
      mascotDragStart: () => void
      mascotDragMove: () => void
      mascotDragEnd: () => void
      mascotActivate: () => void
      /** 右键本体 = 快捷菜单(走出面板锤):收回小探针/看主面板/藏起/退出 */
      mascotMenu: () => void
      /** 右键问一问:资源管理器右键菜单开关(available=false = 开发模式) */
      shellMenuGet: () => Promise<{ available: boolean; enabled: boolean }>
      shellMenuSet: (on: boolean) => Promise<{ ok: boolean; message?: string }>
      /** 冷启动右键文件夹:拉走这个根直接打开(取走即清) */
      launchOpen: () => Promise<string | null>
      /** 开图成功后上报当前项目根:气泡出界判断的依据 */
      reportCurrentRoot: (rootPath: string | null) => void
      /** 气泡窗拉走待处理内容(右键=文件;划词=文本;点桌宠=共享自由对话),取走即清 */
      bubbleOpen: () => Promise<
        | { kind: 'chat' }
        | { kind: 'text'; text: string }
        | {
            kind: 'file'
            path: string
            fileName: string
            folder: string
            inProject: boolean
            relPath: string
            rootPath: string | null
            content: string | null
            readNote?: string
          }
        | null
      >
      /** 已开着的气泡又接到一份新内容 */
      onBubbleFileChanged: (callback: () => void) => () => void
      /** 共享自由对话(桌宠气泡锤):主窗公用场 → 主进程的消息流快照镜像 */
      freechatMirror: (messages: ChatMessage[]) => void
      /** 气泡 → 主窗:代发输入(send/cancel),主进程中转 */
      freechatInput: (payload: FreechatInput) => void
      /** 主窗 ← 气泡:订阅气泡转来的输入;返回退订函数 */
      onFreechatInput: (callback: (payload: FreechatInput) => void) => () => void
      /** 气泡开窗先拉最新快照(null = 主窗还没醒) */
      freechatPull: () => Promise<ChatMessage[] | null>
      /** 气泡订阅会话快照增量;返回退订函数 */
      onFreechatPush: (callback: (messages: ChatMessage[]) => void) => () => void
      /** 收回小探针(走出面板锤):气泡头部钮和主窗占位卡同走这条路 */
      openMainPanel: () => void
      /** 放出小探针(走出面板锤):拖出窗 = 判窗外后落松手点;force = 右键菜单点的,落记忆位 */
      freechatDetach: (force?: boolean) => void
      /** 订阅小探针寄居形态变化(panel/pet):页签 ↔ 占位卡跟着换装;返回退订函数 */
      onFreechatHost: (callback: (host: FreechatHost) => void) => () => void
      /** 主窗收右键转交的文件夹:以它为根打开(热转交) */
      onOpenPath: (callback: (dir: string) => void) => () => void
      /** 划词问一问:全局热键档位(开关+组合键)的读写 */
      wordProbeGet: () => Promise<{ enabled: boolean; accelerator: string }>
      wordProbeSet: (prefs: { enabled: boolean; accelerator: string }) => Promise<{ ok: boolean; message?: string }>
    }
  }
}

export {}
