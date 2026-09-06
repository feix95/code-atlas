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
  FileStructure,
  GitChangesResult,
  ScanResult
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
        question?: string
      ) => Promise<AiExplainResult>
      aiExplainFolder: (rootPath: string, relPath: string, requestId?: string, question?: string) => Promise<AiExplainResult>
      aiChat: (req: AiChatRequest) => Promise<AiChatResult>
      onChatLookup: (callback: (payload: AiChatLookupPayload) => void) => () => void
      gitChanges: (rootPath: string) => Promise<GitChangesResult>
      gitExplainChange: (rootPath: string, relPath: string, requestId?: string) => Promise<AiExplainResult>
      aiCancel: (requestId: string) => Promise<void>
      webLookup: (query: string) => Promise<string>
      onAiDelta: (callback: (payload: AiDeltaPayload) => void) => () => void
    }
  }
}

export {}
