/**
 * IPC 通道名总账(P1-3):全仓 69 个 'atlas:*' 名只许在这一处登记,
 * main 的 on/handle/send 和 preload/renderer 的 invoke/send/on 全引这里 ——
 * 两边对账靠自测走这张表,改名/加名一处生效,不再靠肉眼核对字面量。
 * 注意:uiScaleChanged 是窗口内的 DOM CustomEvent 名(不走 IPC),
 * 因同用 'atlas:' 前缀也放这本账,注释单独标出。
 */
export const CH = {
  // ── 窗口壳 ──
  windowClose: 'atlas:window-close',
  windowMinimize: 'atlas:window-minimize',
  windowMaximizeToggle: 'atlas:window-maximize-toggle',
  windowIsMaximized: 'atlas:window-is-maximized',
  windowMaximized: 'atlas:window-maximized',
  windowDragStart: 'atlas:window-drag-start',
  windowDragMove: 'atlas:window-drag-move',
  // ── 露窗保险与救生圈 ──
  firstFrame: 'atlas:first-frame',
  frameHeartbeat: 'atlas:frame-heartbeat',
  rendererError: 'atlas:renderer-error',
  rendererRevived: 'atlas:renderer-revived',
  // ── 外观与缩放 ──
  appearanceGetSync: 'atlas:appearance-get-sync',
  appearanceSave: 'atlas:appearance-save',
  /** 窗口内 DOM CustomEvent 名(非 IPC):缩放变了,预览字号跟着量尺 */
  uiScaleChanged: 'atlas:ui-scale',
  /** 缩放落盘后报主进程(send 配 on):窗口尺寸记事本按「100% 基准值 × 系数」记账要用 */
  uiScaleSync: 'atlas:ui-scale-sync',
  // ── 系统与项目 ──
  pickFolder: 'atlas:pick-folder',
  listDrives: 'atlas:list-drives',
  browseDir: 'atlas:browse-dir',
  appVersion: 'atlas:app-version',
  scanFolder: 'atlas:scan-folder',
  scanSubdir: 'atlas:scan-subdir',
  // 工作区文件名深搜(UI v3 §7.2,唯一功能变更):invoke 配 handle,最新有效制顶掉旧一轮
  searchNames: 'atlas:search-names',
  analyzeFile: 'atlas:analyze-file',
  readPreview: 'atlas:read-preview',
  depGraph: 'atlas:dep-graph',
  locateFeature: 'atlas:locate-feature',
  // ── 模型货架与下载 ──
  modelShelf: 'atlas:model-shelf',
  modelFiles: 'atlas:model-files',
  modelDownloadStart: 'atlas:model-download-start',
  modelDownloadCancel: 'atlas:model-download-cancel',
  modelDownloadProgress: 'atlas:model-download-progress',
  // ── AI 配置与状态 ──
  aiConfigGet: 'atlas:ai-config-get',
  aiConfigSave: 'atlas:ai-config-save',
  aiListModels: 'atlas:ai-list-models',
  aiTestTavily: 'atlas:ai-test-tavily',
  aiPickFile: 'atlas:ai-pick-file',
  modelStatusGet: 'atlas:model-status-get',
  modelStatus: 'atlas:model-status',
  modelEject: 'atlas:model-eject',
  modelLoad: 'atlas:model-load',
  modelFitCheck: 'atlas:model-fit-check',
  modelContextInfo: 'atlas:model-context-info',
  // ── AI 请求与流 ──
  aiExplainFile: 'atlas:ai-explain-file',
  aiExplainFolder: 'atlas:ai-explain-folder',
  aiChat: 'atlas:ai-chat',
  aiCompact: 'atlas:ai-compact',
  aiStyleSample: 'atlas:ai-style-sample',
  aiChatLookup: 'atlas:ai-chat-lookup',
  aiDelta: 'atlas:ai-delta',
  aiCancel: 'atlas:ai-cancel',
  webLookup: 'atlas:web-lookup',
  // ── Git ──
  gitChanges: 'atlas:git-changes',
  gitExplainChange: 'atlas:git-explain-change',
  gitReport: 'atlas:git-report',
  // ── 文件路径工具 ──
  copyFilePath: 'atlas:copy-file-path',
  revealFilePath: 'atlas:reveal-file-path',
  // ── UI 框架:规格包导出(只写用户自选位置)/ 打开最近一次导出的文件夹 ──
  uiFrameExport: 'atlas:uiframe-export',
  uiFrameRevealExport: 'atlas:uiframe-reveal-export',
  // ── UI 框架:我的方案库(§5.8,只写 userData 下的方案库) ──
  uiFrameSchemeList: 'atlas:uiframe-scheme-list',
  uiFrameSchemeSave: 'atlas:uiframe-scheme-save',
  uiFrameSchemeOpen: 'atlas:uiframe-scheme-open',
  uiFrameSchemeRename: 'atlas:uiframe-scheme-rename',
  uiFrameSchemeDelete: 'atlas:uiframe-scheme-delete',
  uiFrameSchemeSnapshots: 'atlas:uiframe-scheme-snapshots',
  uiFrameSchemeRestore: 'atlas:uiframe-scheme-restore',
  uiFrameSchemeExport: 'atlas:uiframe-scheme-export',
  // ── UI 框架:导入(§14,只读用户自选路径) ──
  uiFrameImportFolder: 'atlas:uiframe-import-folder',
  uiFrameImportFile: 'atlas:uiframe-import-file',
  // ── 立项问卷(§3):立项单 .md 存到用户自选位置 ──
  quizBriefSave: 'atlas:quiz-brief-save',
  // ── 桌宠 ──
  // 撕窗子窗(页签撕窗锤):主窗渲染层替子窗发窗口操作 —— 子窗 document 是
  // about:blank 白窗没有 preload,缩放/关闭由主 realm 代发,主进程按 frameName 认窗
  auxWindowOp: 'atlas:aux-window-op',
  // ── 共享自由对话与气泡 ──

  // ── Developer 日志 ──
  devLogPull: 'atlas:dev-log-pull',
  devLogClear: 'atlas:dev-log-clear',
  devLogOpen: 'atlas:dev-log-open',
  devLog: 'atlas:dev-log'
} as const

/** 全部已登记通道名的类型(写代码时用于注释/校验场景) */
export type IpcChannel = (typeof CH)[keyof typeof CH]
