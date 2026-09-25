import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/ipcChannels.ts'
import { ROOT_FONT_BASE_PX, clampUiScale } from '../shared/uiScale.ts'
import { readNumPref, writeNumPref } from '../shared/localPrefs.ts'
import type { Appearance } from '../shared/appearancePrefs.ts'
import type { TavilyProbeResult } from '../shared/tavily.ts'
import type { ModelDownloadProgress, RepoFile, ShelfResult } from '../shared/modelShelf.ts'
import type { SearchNamesResult } from '../shared/searchNames.ts'
import type {
  AiChatLookupPayload,
  AiChatRequest,
  AiChatResult,
  AiCompactRequest,
  AiConfig,
  AiDeltaPayload,
  AiExplainResult,
  BrowseEntry,
  BubbleResizeMsg,
  ChatMessage,
  DepGraphResult,
  DriveInfo,
  FeatureLocateResult,
  FileStructure,
  FilePreviewResult,
  FreechatHost,
  FreechatInput,
  GitChangesResult,
  ModelContextInfo,
  ModelFitVerdict,
  ModelStatus,
  ScanDirNode,
  ScanResult,
  DevLogEntry
} from '../shared/types.ts'

// 界面缩放(第四十七锤起换引擎):不再用 webFrame.setZoomFactor —— 那是 Chromium 整页缩放,
// 会把整个渲染坐标系缩一顿,无边框自绘窗的「鼠标判定」和「视觉框」就对不上:
// 设置面板 × 视觉上正对着却点不中、拖边热区跑出窗框、设置页比窗还大,三个连环 bug 同这个根。
// 现在改成改根字号:html 的 font-size = 16px × 系数,布局/字号/图标全挂 rem 跟着变,
// 没有第二套坐标系,鼠标坐标和视觉永远 1:1。存 localStorage,页面脚本跑之前就定好,不会先小后大闪一下。
// 超出范围的旧存档贴边处理(不再静默跳回 100%,用户调过 180% 就给他 180%)
// 档位/基准/夹紧的户口在 shared/uiScale.ts:设置页滑块和侧栏 rem 换算同认那一份
const UI_SCALE_KEY = 'atlas.ui-scale'

function applyRootFont(factor: number): void {
  const set = (): void => {
    document.documentElement.style.fontSize = `${(ROOT_FONT_BASE_PX * factor).toFixed(2)}px`
  }
  // preload 跑在页面脚本之前,documentElement 一般已经在;万一没好就等 DOM 一就绪立刻补上
  if (document.documentElement) set()
  else document.addEventListener('DOMContentLoaded', set, { once: true })
}

function readUiScale(): number {
  return clampUiScale(readNumPref(UI_SCALE_KEY, 0))
}
applyRootFont(readUiScale())

// 首帧信号:连跑两个动画帧 = 合成器真的画出了画面,主进程收到才敢露窗。
// 这是露窗链的主保险 —— 无边框模式下 ready-to-show 在部分高缩放屏上永不触发
// (第三十六锤补实测),不能指望它;主进程另备 3 秒看门狗兜底,窗口绝不永久隐身
requestAnimationFrame(() => {
  requestAnimationFrame(() => ipcRenderer.send(CH.firstFrame))
})

// 挂在 window.atlas 命名空间下:版本信息、选文件夹、扫描、AST 分析,都从这儿走。
// 桥对象先落成具名常量再 expose —— env.d.ts 的 Window.atlas 类型用 typeof atlasApi
// 直接推导(P1-3),改实现一处签名自动跟着走,不再手抄镜像声明
const atlasApi = {
  versions: {
    node: (): string => process.versions.node,
    chrome: (): string => process.versions.chrome,
    electron: (): string => process.versions.electron
  },
  getUiScale: (): number => readUiScale(),
  setUiScale: (factor: number): void => {
    const f = clampUiScale(Number(factor))
    writeNumPref(UI_SCALE_KEY, f)
    applyRootFont(f)
    // 喊一声界面:侧栏宽度这类「按比例跟缩放」的布局要实时跟着重算
    window.dispatchEvent(new CustomEvent(CH.uiScaleChanged, { detail: f }))
    // 落盘的系数同步给主进程:窗口记事本存的是 100% 基准值,应用时乘它还原物理尺寸
    ipcRenderer.send(CH.uiScaleSync, f)
  },
  // 设置弹窗的暂存预览:根字号跟着草稿走,但不写 localStorage —— 点「应用更改」才真正 setUiScale 落盘
  previewUiScale: (factor: number): void => {
    const f = clampUiScale(Number(factor))
    applyRootFont(f)
    window.dispatchEvent(new CustomEvent(CH.uiScaleChanged, { detail: f }))
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(CH.pickFolder),
  // 外观偏好(2026-09-16 起存主进程 appearance.json,不再用 localStorage):
  // getSync 是同步通道(sendSync 配 ipcMain.on),页面脚本跑之前把外观定下来,首帧不闪默认皮;
  // save 走 invoke(配 ipcMain.handle)异步落盘。
  // 2026-09-17 修:原来这里是 send 而主进程那边是 handle —— 一边发件一边只收 invoke,
  // 消息被静默丢弃,appearance.json 一次都没写成过,外观重启就回出厂。收发必须成对:
  // send/sendSync 配 ipcMain.on,invoke 配 ipcMain.handle。
  appearance: {
    getSync: (): Appearance | null => ipcRenderer.sendSync(CH.appearanceGetSync),
    save: (a: Appearance): Promise<void> => ipcRenderer.invoke(CH.appearanceSave, a)
  },
  // 列盘符(只问有哪些盘,不翻文件内容);app 版本号(设置里的版本信息行用)
  listDrives: (): Promise<DriveInfo[]> => ipcRenderer.invoke(CH.listDrives),
  /** 「这台电脑」下钻:列某目录的直属一层(不递归),忽略名单/符号链接与扫描同口径 */
  browseDir: (absPath: string): Promise<BrowseEntry[]> => ipcRenderer.invoke(CH.browseDir, absPath),
  appVersion: (): Promise<string> => ipcRenderer.invoke(CH.appVersion),
  // 自绘窗口壳:三颗灰点背后的真动作 + 最大化状态同步,渲染进程不许直接碰 BrowserWindow
  windowClose: (): Promise<void> => ipcRenderer.invoke(CH.windowClose),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke(CH.windowMinimize),
  windowMaximizeToggle: (): Promise<boolean> => ipcRenderer.invoke(CH.windowMaximizeToggle),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke(CH.windowIsMaximized),
  /** 页签尾空白的手动搬窗(send 配 on):start=按下的屏幕坐标(最大化会先还原),move=位移增量 */
  windowDragStart: (x: number, y: number): void => {
    ipcRenderer.send(CH.windowDragStart, x, y)
  },
  windowDragMove: (dx: number, dy: number): void => {
    ipcRenderer.send(CH.windowDragMove, dx, dy)
  },
  /** 订阅最大化/还原状态变化;返回退订函数,组件卸载时调用 */
  onWindowMaximized: (callback: (maximized: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void =>
      callback(maximized)
    ipcRenderer.on(CH.windowMaximized, listener)
    return () => ipcRenderer.removeListener(CH.windowMaximized, listener)
  },
  scanFolder: (folderPath: string): Promise<ScanResult> =>
    ipcRenderer.invoke(CH.scanFolder, folderPath),
  scanSubdir: (rootPath: string, relPath: string): Promise<ScanResult> =>
    ipcRenderer.invoke(CH.scanSubdir, rootPath, relPath),
  /** 工作区文件名深搜(UI v3 §7.2):主进程真扫磁盘,新词顶掉在跑的旧一轮 */
  searchNames: (rootPath: string, query: string): Promise<SearchNamesResult> =>
    ipcRenderer.invoke(CH.searchNames, rootPath, query),
  analyzeFile: (
    rootPath: string,
    relPath: string,
    languageId: string
  ): Promise<FileStructure | null> =>
    ipcRenderer.invoke(CH.analyzeFile, rootPath, relPath, languageId),
  /** 代码预览:读一个文件的前一段当文本看(二进制/超大/读不了都有专门的话,不硬塞乱码) */
  readPreview: (rootPath: string, relPath: string): Promise<FilePreviewResult> =>
    ipcRenderer.invoke(CH.readPreview, rootPath, relPath),
  depGraph: (rootPath: string): Promise<DepGraphResult> =>
    ipcRenderer.invoke(CH.depGraph, rootPath),
  // 模型货架:实时榜(双源拉取+本机家底)+ 仓库文件清单
  modelShelf: (): Promise<ShelfResult> => ipcRenderer.invoke(CH.modelShelf),
  modelFiles: (repoId: string): Promise<RepoFile[]> => ipcRenderer.invoke(CH.modelFiles, repoId),
  // 一键到位:点文件 → 断点续传下载 → 自动填 AI 配置;进度走事件推送
  modelDownloadStart: (repoId: string, filePath: string): Promise<string> =>
    ipcRenderer.invoke(CH.modelDownloadStart, { repoId, filePath }),
  modelDownloadCancel: (): Promise<boolean> => ipcRenderer.invoke(CH.modelDownloadCancel),
  onModelDownloadProgress: (callback: (p: ModelDownloadProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, p: ModelDownloadProgress): void =>
      callback(p)
    ipcRenderer.on(CH.modelDownloadProgress, listener)
    return () => ipcRenderer.removeListener(CH.modelDownloadProgress, listener)
  },
  aiConfigGet: (): Promise<AiConfig> => ipcRenderer.invoke(CH.aiConfigGet),
  aiConfigSave: (config: AiConfig): Promise<AiConfig> =>
    ipcRenderer.invoke(CH.aiConfigSave, config),
  aiListModels: (baseUrl: string): Promise<string[]> =>
    ipcRenderer.invoke(CH.aiListModels, baseUrl),
  /** Tavily Key 体检(2026-09-17):拿框里这把 Key 真打一次官方接口,只回结论,不回显 Key */
  aiTestTavily: (key: string): Promise<TavilyProbeResult> =>
    ipcRenderer.invoke(CH.aiTestTavily, key),
  aiPickFile: (): Promise<string | null> => ipcRenderer.invoke(CH.aiPickFile),
  aiExplainFile: (
    rootPath: string,
    relPath: string,
    languageId: string,
    requestId?: string,
    question?: string,
    note?: string
  ): Promise<AiExplainResult> =>
    ipcRenderer.invoke(CH.aiExplainFile, rootPath, relPath, languageId, requestId, question, note),
  aiExplainFolder: (
    rootPath: string,
    relPath: string,
    requestId?: string,
    question?: string
  ): Promise<AiExplainResult> =>
    ipcRenderer.invoke(CH.aiExplainFolder, rootPath, relPath, requestId, question),
  /** 自由对话:独立通道,资料当附件、联网状态程序记账,与文件解释互不掺和 */
  aiChat: (req: AiChatRequest): Promise<AiChatResult> => ipcRenderer.invoke(CH.aiChat, req),
  /** /compact 手动压缩(第一百四十二锤):把目前为止的对话提炼成摘要,流式增量走 atlas:ai-delta */
  aiCompact: (req: AiCompactRequest): Promise<AiExplainResult> =>
    ipcRenderer.invoke(CH.aiCompact, req),
  /** 试一句(第一百一十三锤):拿「还没保存的草稿」念一段,当场听说话方式的效果 */
  aiStyleSample: (personalization: unknown, requestId?: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke(CH.aiStyleSample, personalization, requestId),
  /** 订阅自由对话的联网状态播报(查询中/查到/没查到);返回退订函数 */
  onChatLookup: (callback: (payload: AiChatLookupPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AiChatLookupPayload): void =>
      callback(payload)
    ipcRenderer.on(CH.aiChatLookup, listener)
    return () => ipcRenderer.removeListener(CH.aiChatLookup, listener)
  },
  gitChanges: (rootPath: string): Promise<GitChangesResult> =>
    ipcRenderer.invoke(CH.gitChanges, rootPath),
  gitExplainChange: (
    rootPath: string,
    relPath: string,
    requestId?: string
  ): Promise<AiExplainResult> =>
    ipcRenderer.invoke(CH.gitExplainChange, rootPath, relPath, requestId),
  /** AI 干活报告:整轮改动翻成大白话审计,流式增量走 atlas:ai-delta,按 requestId 对号 */
  gitReport: (rootPath: string, requestId?: string): Promise<AiExplainResult> =>
    ipcRenderer.invoke(CH.gitReport, rootPath, requestId),
  /** 功能定位:「这个功能在哪」—— 扫描树递给主进程当地图,带路人指路,防编造校验在主进程 */
  locateFeature: (
    tree: ScanDirNode,
    question: string,
    requestId?: string
  ): Promise<FeatureLocateResult> =>
    ipcRenderer.invoke(CH.locateFeature, tree, question, requestId),
  /** 掐掉还在生成的讲解:换了讲解目标/关掉卡片时喊一声,模型立刻空出来 */
  aiCancel: (requestId: string): Promise<void> => ipcRenderer.invoke(CH.aiCancel, requestId),
  /** 联网查证(默认关):只把「名字」交给主进程去查公开资料,渲染进程不碰网络 */
  webLookup: (query: string): Promise<string> => ipcRenderer.invoke(CH.webLookup, query),
  /** 订阅 AI 流式增量;返回退订函数,组件卸载时调用,防止泄漏监听 */
  onAiDelta: (callback: (payload: AiDeltaPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AiDeltaPayload): void =>
      callback(payload)
    ipcRenderer.on(CH.aiDelta, listener)
    return () => ipcRenderer.removeListener(CH.aiDelta, listener)
  },
  // ── 模型状态栏(第七十锤):查一次现状 + 订阅后续变化 + 取消热身/卸下模型 ──
  modelStatusGet: (): Promise<ModelStatus> => ipcRenderer.invoke(CH.modelStatusGet),
  modelEject: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke(CH.modelEject),
  /** 右键文件链接复制完整路径:主进程 joinRoot 拼绝对路径写进剪贴板,只复制不打开 */
  copyFilePath: (
    rootPath: string,
    relPath: string
  ): Promise<{ ok: boolean; path?: string; message?: string }> =>
    ipcRenderer.invoke(CH.copyFilePath, rootPath, relPath),
  /** 右键文件链接「在文件资源管理器中显示」:资源管理器弹出并选中文件,不开文件 */
  revealFilePath: (rootPath: string, relPath: string): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(CH.revealFilePath, rootPath, relPath),
  /** 订阅模型状态变化(热身进度/就绪/出岔子);返回退订函数,组件卸载时调用 */
  onModelStatus: (callback: (status: ModelStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: ModelStatus): void =>
      callback(status)
    ipcRenderer.on(CH.modelStatus, listener)
    return () => ipcRenderer.removeListener(CH.modelStatus, listener)
  },
  /** 量尺(第七十三锤):模型块头 vs 机器尺寸,选模型那一刻就给结论 */
  modelFitCheck: (modelPath: string): Promise<ModelFitVerdict> =>
    ipcRenderer.invoke(CH.modelFitCheck, modelPath),
  /** 模型档案(上下文档位的账本):出厂上限 + 层数头数 + 机器家底,一次端齐;翻不到回 null */
  modelContextInfo: (modelPath: string): Promise<ModelContextInfo | null> =>
    ipcRenderer.invoke(CH.modelContextInfo, modelPath),
  /** 救生圈的复活信号:画面断了被主进程重接回来时喊一声,页面弹人话横幅;返回退订函数 */
  onRendererRevived: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(CH.rendererRevived, listener)
    return () => ipcRenderer.removeListener(CH.rendererRevived, listener)
  },
  /** 报错小纸条:渲染层抓到的 JS 错误送进后台账本(主进程的账本不随渲染层陪葬) */
  reportRendererError: (text: string): void => {
    ipcRenderer.send(CH.rendererError, text)
  },
  /** 画面心跳(救生圈2.0):rAF 每秒报一跳「画面循环还在转」;窗露着心跳却停了,主进程自动重挂救命 */
  frameHeartbeat: (): void => {
    ipcRenderer.send(CH.frameHeartbeat)
  },
  // ── 桌宠(桌宠托管第二锤):拖动三连 + 点击激活 + 右键菜单,全是单向 send(配主进程 ipcMain.on);
  //    穿透判定全在主进程轮询,渲染层不上报(「又拖不动」第三案的治法,主仓趟平版移植) ──
  /** 页面挂载时拉一次露面状态:藏起期间页面重载,别让它变「看得见点不着的幽灵」(invoke 配 handle) */
  mascotVisibilityGet: (): Promise<boolean> => ipcRenderer.invoke(CH.mascotVisibleGet),
  /** 订主进程的藏/露推送:藏起 = 不画身体(假藏,第六案);返回退订函数 */
  onMascotVisibility: (fn: (visible: boolean) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, v: unknown): void => fn(v === true)
    ipcRenderer.on(CH.mascotVisible, h)
    return () => ipcRenderer.removeListener(CH.mascotVisible, h)
  },
  mascotDragStart: (): void => {
    ipcRenderer.send(CH.mascotDragStart)
  },
  mascotDragMove: (): void => {
    ipcRenderer.send(CH.mascotDragMove)
  },
  mascotDragEnd: (): void => {
    ipcRenderer.send(CH.mascotDragEnd)
  },
  mascotActivate: (): void => {
    ipcRenderer.send(CH.mascotActivate)
  },
  /** 右键本体 = 快捷菜单(走出面板锤) */
  mascotMenu: (): void => {
    ipcRenderer.send(CH.mascotMenu)
  },
  // ── 共享自由对话(桌宠气泡锤):气泡是主窗公用场的影子窗 ——
  // 主窗推快照(mirror/send 配 on),气泡拉最新(pull/invoke 配 handle)并订阅增量(push),
  // 气泡的输入经主进程转回主窗(input/send 配 on,两头同通道名:气泡发、主窗收)
  /** 主窗公用场 → 主进程:消息流快照镜像(ChatMessage[];节流后推送) */
  freechatMirror: (messages: ChatMessage[]): void => {
    ipcRenderer.send(CH.freechatMirror, messages)
  },
  /** 气泡 → 主窗:代发输入(send/cancel);主进程中转,只认气泡窗来的 */
  freechatInput: (payload: FreechatInput): void => {
    ipcRenderer.send(CH.freechatInput, payload)
  },
  /** 主窗 ← 气泡:订阅气泡转来的输入;返回退订函数 */
  onFreechatInput: (callback: (payload: FreechatInput) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: FreechatInput): void =>
      callback(payload)
    ipcRenderer.on(CH.freechatInput, listener)
    return () => ipcRenderer.removeListener(CH.freechatInput, listener)
  },
  /** 气泡开窗先拉最新快照(没有 = 主窗还没醒);invoke 配 handle */
  freechatPull: (): Promise<ChatMessage[] | null> => ipcRenderer.invoke(CH.freechatPull),
  /** 气泡订阅会话快照增量(主窗每变一次推一次);返回退订函数 */
  onFreechatPush: (callback: (messages: ChatMessage[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, messages: ChatMessage[]): void =>
      callback(messages)
    ipcRenderer.on(CH.freechatPush, listener)
    return () => ipcRenderer.removeListener(CH.freechatPush, listener)
  },
  /** 收回小探针(走出面板锤):气泡头部钮和主窗占位卡同走这条路 —— 主窗亮+页签复活+气泡收+桌宠下班 */
  openMainPanel: (): void => {
    ipcRenderer.send(CH.openMain)
  },
  /** 气泡拖拽缩放三连(气泡放大锤):begin/move/end,光标屏幕坐标 DIP;send 配 on */
  bubbleResize: (msg: BubbleResizeMsg): void => {
    ipcRenderer.send(CH.bubbleResize, msg)
  },
  /** 放出小探针(走出面板锤):页签被拖出主窗松手 → 主进程判窗外 → 变身桌宠;
   * force = 页签右键菜单点的「放到桌面」,不判窗外,桌宠落记忆位。send 配 on */
  freechatDetach: (force?: boolean): void => {
    ipcRenderer.send(CH.freechatDetach, force === true)
  },
  /** 订阅小探针寄居形态变化(panel/pet):页签 ↔ 占位卡跟着换装;返回退订函数 */
  onFreechatHost: (callback: (host: FreechatHost) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, host: FreechatHost): void => callback(host)
    ipcRenderer.on(CH.freechatHost, listener)
    return () => ipcRenderer.removeListener(CH.freechatHost, listener)
  },
  // ── Developer 日志(第八十七锤):拉旧账 / 清账 / 开窗 / 订阅新账 ──
  devLogsPull: (): Promise<DevLogEntry[]> => ipcRenderer.invoke(CH.devLogPull),
  devLogsClear: (): Promise<void> => ipcRenderer.invoke(CH.devLogClear),
  devLogsOpen: (): Promise<void> => ipcRenderer.invoke(CH.devLogOpen),
  /** 订阅新日志条目;返回退订函数,组件卸载时调用 */
  onDevLog: (callback: (entry: DevLogEntry) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: DevLogEntry): void =>
      callback(entry)
    ipcRenderer.on(CH.devLog, listener)
    return () => ipcRenderer.removeListener(CH.devLog, listener)
  }
}

contextBridge.exposeInMainWorld('atlas', atlasApi)

/** window.atlas 的权威类型:从桥对象直接推导,渲染层 env.d.ts 引它 */
export type AtlasApi = typeof atlasApi
