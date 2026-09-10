/// <reference types="vite/client" />

import type {
  AiChatLookupPayload,
  AiChatRequest,
  AiChatResult,
  AiConfig,
  AiDeltaPayload,
  AiExplainResult,
  DepGraphResult,
  DriveInfo,
  FeatureLocateResult,
  FilePreviewResult,
  FileStructure,
  GitChangesResult,
  ModelFitVerdict,
  ModelStatus,
  ScanDirNode,
  ScanResult,
  DevLogEntry
} from '../../../shared/types.ts'

declare global {
  interface Window {
    atlas: {
      versions: {
        node: () => string
        chrome: () => string
        electron: () => string
      }
      pickFolder: () => Promise<string | null>
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
      aiConfigGet: () => Promise<AiConfig>
      aiConfigSave: (config: AiConfig) => Promise<AiConfig>
      aiListModels: (baseUrl: string) => Promise<string[]>
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
      /** 订阅模型状态变化(热身进度/就绪/出岔子);返回退订函数 */
      onModelStatus: (callback: (status: ModelStatus) => void) => () => void
      /** 量尺:模型块头 vs 机器尺寸,选模型那一刻就给结论(绿装得下/黄有点挤/红装不下) */
      modelFitCheck: (modelPath: string) => Promise<ModelFitVerdict>
      /** Developer 日志(第八十七锤):拉旧账 / 清账 / 开窗 / 订阅新账 */
      devLogsPull: () => Promise<DevLogEntry[]>
      devLogsClear: () => Promise<void>
      devLogsOpen: () => Promise<void>
      onDevLog: (callback: (entry: DevLogEntry) => void) => () => void
    }
  }
}

export {}
