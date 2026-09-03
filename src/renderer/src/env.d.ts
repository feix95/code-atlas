/// <reference types="vite/client" />

import type { FileStructure, ScanResult } from '../../../shared/types.ts'

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
    }
  }
}

export {}
