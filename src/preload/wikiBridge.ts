// AI Wiki 的 preload 桥:主进程通道集中在这里,index.ts 只把它挂到 window.atlas.wiki。
import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH } from '../shared/ipcChannels.ts'
import type {
  WikiCleanupOutcome,
  WikiEvent,
  WikiFileOpResult,
  WikiLocationChoice,
  WikiPanelRequest,
  WikiPanelStateResult,
  WikiProjectStateResult,
  WikiRootScan,
  WikiRunStatus,
  WikiSettings,
  WikiStartRequest,
  WikiStartResult,
  WikiPlanCatalogRequest,
  WikiPlanCatalogResult,
  WikiStartV2Request,
  WikiWallResult
} from '../shared/wikiTypes.ts'
import type {
  WallImageReadResult,
  WallImageSaveResult,
  WallSticker,
  WallStickersLoadResult,
  WallStickersSaveResult
} from '../shared/wikiWallNotes.ts'

export const wikiBridge = {
  settingsGet: (): Promise<WikiSettings> => ipcRenderer.invoke(CH.wikiSettingsGet),
  saveLanguage: (language: string): Promise<WikiFileOpResult> =>
    ipcRenderer.invoke(CH.wikiSaveLanguage, language),
  chooseLocation: (projectRoots: string[]): Promise<WikiLocationChoice> =>
    ipcRenderer.invoke(CH.wikiChooseLocation, projectRoots),
  scanRoot: (): Promise<WikiRootScan> => ipcRenderer.invoke(CH.wikiScanRoot),
  projectState: (projectRoot: string): Promise<WikiProjectStateResult> =>
    ipcRenderer.invoke(CH.wikiProjectState, projectRoot),
  panelState: (request: WikiPanelRequest): Promise<WikiPanelStateResult> =>
    ipcRenderer.invoke(CH.wikiPanelState, request),
  wallState: (projectRoot: string, language: string): Promise<WikiWallResult> =>
    ipcRenderer.invoke(CH.wikiWallState, { projectRoot, language }),
  /** 线索桌上用户贴的便签与图片,跟着 Wiki 存在项目目录下 */
  wallStickersLoad: (projectRoot: string): Promise<WallStickersLoadResult> =>
    ipcRenderer.invoke(CH.wikiWallStickersLoad, projectRoot),
  wallStickersSave: (
    projectRoot: string,
    stickers: WallSticker[]
  ): Promise<WallStickersSaveResult> =>
    ipcRenderer.invoke(CH.wikiWallStickersSave, projectRoot, stickers),
  wallImageSave: (projectRoot: string, bytes: Uint8Array): Promise<WallImageSaveResult> =>
    ipcRenderer.invoke(CH.wikiWallImageSave, projectRoot, bytes),
  wallImageRead: (projectRoot: string, file: string): Promise<WallImageReadResult> =>
    ipcRenderer.invoke(CH.wikiWallImageRead, projectRoot, file),
  start: (request: WikiStartRequest): Promise<WikiStartResult> =>
    ipcRenderer.invoke(CH.wikiStart, request),
  runStatus: (): Promise<WikiRunStatus> => ipcRenderer.invoke(CH.wikiRunStatus),
  cancel: (): Promise<void> => ipcRenderer.invoke(CH.wikiCancel),
  startV2: (request: WikiStartV2Request): Promise<WikiStartResult> =>
    ipcRenderer.invoke(CH.wikiStartV2, request),
  planCatalog: (request: WikiPlanCatalogRequest): Promise<WikiPlanCatalogResult> =>
    ipcRenderer.invoke(CH.wikiPlanCatalog, request),
  runStatusV2: (): Promise<WikiRunStatus> => ipcRenderer.invoke(CH.wikiRunStatusV2),
  cancelV2: (): Promise<void> => ipcRenderer.invoke(CH.wikiCancelV2),
  cleanupAll: (): Promise<WikiCleanupOutcome> => ipcRenderer.invoke(CH.wikiCleanupAll),
  cleanupProject: (projectRoot: string): Promise<WikiCleanupOutcome> =>
    ipcRenderer.invoke(CH.wikiCleanupProject, projectRoot),
  openDoc: (projectRoot: string, language: string, file: string): Promise<WikiFileOpResult> =>
    ipcRenderer.invoke(CH.wikiOpenDoc, { projectRoot, language, file }),
  revealDoc: (projectRoot: string, language: string, file: string): Promise<WikiFileOpResult> =>
    ipcRenderer.invoke(CH.wikiRevealDoc, { projectRoot, language, file }),
  openLocation: (): Promise<WikiFileOpResult> => ipcRenderer.invoke(CH.wikiOpenLocation),
  /** 订阅逐页进度与收场汇总;返回退订函数 */
  onEvent: (callback: (event: WikiEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: WikiEvent): void => callback(payload)
    ipcRenderer.on(CH.wikiEvent, listener)
    return () => ipcRenderer.removeListener(CH.wikiEvent, listener)
  }
}
