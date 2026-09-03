/// <reference types="vite/client" />

import type { AiConfig, AiExplainResult, DepGraphResult, FileStructure, ScanResult } from '../../../shared/types.ts'

declare global {
  interface Window {
    atlas: {
      versions: {
        node: () => string
        chrome: () => string
        electron: () => string
      }
      pickFolder: () => Promise<string | null>
      scanFolder: (folderPath: string) => Promise<ScanResult>
      analyzeFile: (rootPath: string, relPath: string, languageId: string) => Promise<FileStructure | null>
      depGraph: (rootPath: string) => Promise<DepGraphResult>
      aiConfigGet: () => Promise<AiConfig>
      aiConfigSave: (config: AiConfig) => Promise<AiConfig>
      aiListModels: (baseUrl: string) => Promise<string[]>
      aiExplainFile: (rootPath: string, relPath: string, languageId: string) => Promise<AiExplainResult>
    }
  }
}

export {}
