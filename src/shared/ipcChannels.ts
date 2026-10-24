/**
 * IPC 通道名总账(P1-3):全仓 69 个 'atlas:*' 名只许在这一处登记,
 * main 的 on/handle/send 和 preload/renderer 的 invoke/send/on 全引这里 ——
 * 两边对账靠自测走这张表,改名/加名一处生效,不再靠肉眼核对字面量。
 * 注意:uiScaleChanged 是窗口内的 DOM CustomEvent 名(不走 IPC),
 * 因同用 'atlas:' 前缀也放这本账,注释单独标出。
 */
export const CH = {
  // 窗口壳
  windowClose: 'atlas:window-close',
  windowMinimize: 'atlas:window-minimize',
  windowMaximizeToggle: 'atlas:window-maximize-toggle',
  windowIsMaximized: 'atlas:window-is-maximized',
  windowMaximized: 'atlas:window-maximized',
  windowDragStart: 'atlas:window-drag-start',
  windowDragMove: 'atlas:window-drag-move',
  // 露窗保险与救生圈
  firstFrame: 'atlas:first-frame',
  frameHeartbeat: 'atlas:frame-heartbeat',
  rendererError: 'atlas:renderer-error',
  rendererRevived: 'atlas:renderer-revived',
  // 外观与缩放
  appearanceGetSync: 'atlas:appearance-get-sync',
  appearanceSave: 'atlas:appearance-save',
  /** 窗口内 DOM CustomEvent 名(非 IPC):缩放变了,预览字号跟随适配估算 */
  uiScaleChanged: 'atlas:ui-scale',
  /** 缩放落盘后报主进程(send 配 on):窗口尺寸记事本按「100% 基准值 × 系数」记账要用 */
  uiScaleSync: 'atlas:ui-scale-sync',
  // 系统与项目
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
  // 模型货架与下载
  modelShelf: 'atlas:model-shelf',
  modelFiles: 'atlas:model-files',
  modelDownloadStart: 'atlas:model-download-start',
  modelDownloadCancel: 'atlas:model-download-cancel',
  modelDownloadProgress: 'atlas:model-download-progress',
  // AI 配置与状态
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
  // 本机运行方案(机器规格 + 当前内置模型的启动计划,只读)
  aiLaunchPlan: 'atlas:ai-launch-plan',
  // 引擎后端管理:状态查询/一键安装/取消/卸载;进度走 push 通道
  engineState: 'atlas:engine-state',
  engineInstall: 'atlas:engine-install',
  engineInstallCancel: 'atlas:engine-install-cancel',
  engineRemove: 'atlas:engine-remove',
  /** 主进程 → 渲染层推送:引擎安装进度(stage + percent) */
  engineInstallProgress: 'atlas:engine-install-progress',
  // AI 请求与流
  aiChat: 'atlas:ai-chat',
  aiCompact: 'atlas:ai-compact',
  aiStyleSample: 'atlas:ai-style-sample',
  aiChatLookup: 'atlas:ai-chat-lookup',
  aiDelta: 'atlas:ai-delta',
  aiCancel: 'atlas:ai-cancel',
  webLookup: 'atlas:web-lookup',
  // 文件翻译(镜像页签)
  translateStart: 'atlas:translate-start',
  translateCancel: 'atlas:translate-cancel',
  /** 主进程 → 渲染层推送:翻译计划 / 逐块译文 / 完成 / 失败 */
  translateEvent: 'atlas:translate-event',
  // 文件路径工具
  copyFilePath: 'atlas:copy-file-path',
  revealFilePath: 'atlas:reveal-file-path',
  /** 树文件夹右键「打开为工作区」:joinRoot 出绝对路径,确认是目录后交给扫描,不写剪贴板 */
  resolveFilePath: 'atlas:resolve-file-path',
  // 文件编辑与监视( / )
  saveFile: 'atlas:save-file',
  renameFile: 'atlas:rename-file',
  watchFile: 'atlas:watch-file',
  unwatchFile: 'atlas:unwatch-file',
  /** 主进程 → 渲染层推送:打开中的文件被外部改了(全员广播,各窗自己对账) */
  fileChanged: 'atlas:file-changed',
  // 桌宠
  // 独立子窗(页签独立窗口):主窗渲染层替子窗发窗口操作 —— 子窗 document 是
  // about:blank 白窗没有 preload,缩放/关闭由主 realm 代发,主进程按 frameName 认窗
  auxWindowOp: 'atlas:aux-window-op',
  /** 跨窗拖页签:取所有窗内容区矩形(invoke 配 handle),拖拽开始时问一次 */
  auxWindowRects: 'atlas:aux-window-rects',
  // 共享自由对话与气泡

  // Developer 日志
  devLogPull: 'atlas:dev-log-pull',
  devLogClear: 'atlas:dev-log-clear',
  devLogOpen: 'atlas:dev-log-open',
  devLog: 'atlas:dev-log'
} as const

/** 全部已登记通道名的类型(写代码时用于注释/校验场景) */
export type IpcChannel = (typeof CH)[keyof typeof CH]
