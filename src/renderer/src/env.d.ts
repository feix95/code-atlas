/// <reference types="vite/client" />

import type {
  AiConfig,
  AiDeltaPayload,
  AiExplainResult,
  DepGraphResult,
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
      getUiScale: () => number
      setUiScale: (factor: number) => void
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
      aiExplainFile: (rootPath: string, relPath: string, languageId: string, requestId?: string, question?: string) => Promise<AiExplainResult>
      aiExplainFolder: (rootPath: string, relPath: string, requestId?: string, question?: string) => Promise<AiExplainResult>
      gitChanges: (rootPath: string) => Promise<GitChangesResult>
      gitExplainChange: (rootPath: string, relPath: string, requestId?: string) => Promise<AiExplainResult>
      aiCancel: (requestId: string) => Promise<void>
      onAiDelta: (callback: (payload: AiDeltaPayload) => void) => () => void
    }
  }
}

export {}
