// AI Wiki 的主进程入口:设置与位置、项目快照、清理与打开文档。
// 渲染层递来的一切路径都当外部输入:项目内路径走 joinRoot,文档路径只认记账登记的相对路径。
import { promises as fs } from 'node:fs'
import { BrowserWindow, ipcMain, shell } from 'electron'
import { CH } from '../shared/ipcChannels.ts'
import { translateLang } from '../shared/translateLangs.ts'
import type {
  WikiCleanupOutcome,
  WikiFileOpResult,
  WikiLocationChoice,
  WikiProjectStateResult,
  WikiRootScan
} from '../shared/wikiTypes.ts'
import { pickPathDialog } from './atlasWindow.ts'
import { userDataDir } from './paths.ts'
import { parseProjectRoot } from './wikiRequest.ts'
import { resolveWikiDocPath } from './wikiDocPath.ts'
import { isWikiJobActive } from './wikiRun.ts'
import { ensureWikiRootMarker, resolveWikiLocation } from '../wiki/wikiLocation.ts'
import { loadWikiSettings, saveWikiSettings } from '../wiki/wikiSettings.ts'
import { cleanupWiki, scanWikiRoot } from '../wiki/wikiCleanup.ts'
import { pageFileExists, readWikiState, resolveProjectDir } from '../wiki/wikiStore.ts'

function wikiRoot(): string | null {
  return loadWikiSettings(userDataDir()).location
}

async function isDirectory(path: string): Promise<boolean> {
  const stat = await fs.stat(path).catch(() => null)
  return stat?.isDirectory() === true
}

function emptyScan(location: string | null): WikiRootScan {
  return { location, projects: 0, pages: 0, files: 0, bytes: 0, damaged: [] }
}

async function projectState(raw: unknown): Promise<WikiProjectStateResult> {
  const projectRoot = parseProjectRoot(raw)
  if (projectRoot === null) return { ok: false, error: '项目路径不合法' }
  const location = wikiRoot()
  if (location === null) return { ok: false, error: '还没选 Wiki 存放位置' }
  const projectDir = await resolveProjectDir(location, projectRoot)
  const read = await readWikiState(projectDir)
  if (read.status === 'damaged') {
    return { ok: true, projectDir, damaged: true, languages: [] }
  }
  if (read.status === 'missing') {
    return { ok: true, projectDir, damaged: false, languages: [] }
  }
  const languages = await Promise.all(
    Object.values(read.state.languages).map(async (language) => ({
      code: language.code,
      label: language.label,
      pages: await Promise.all(
        Object.values(language.pages).map(async (record) => {
          const exists = await pageFileExists(projectDir, language.code, record)
          return {
            pageId: record.pageId,
            kind: record.kind,
            name: record.name,
            status: record.status === 'done' && !exists ? ('missing' as const) : record.status,
            file: record.file,
            generatedAt: record.generatedAt,
            model: record.model,
            truncated: record.truncated === true,
            exists
          }
        })
      )
    }))
  )
  return { ok: true, projectDir, damaged: false, languages }
}

/** 打开文档只认语种目录下记账形状的相对路径;realpath 必须仍在 Wiki 根内 */
function docPath(raw: unknown): Promise<{ path: string } | { error: string }> {
  return resolveWikiDocPath(raw, wikiRoot())
}

function registerSettings(): void {
  ipcMain.handle(CH.wikiSettingsGet, () => loadWikiSettings(userDataDir()))
  ipcMain.handle(CH.wikiSaveLanguage, (_event, raw: unknown): WikiFileOpResult => {
    if (typeof raw !== 'string' || translateLang(raw) === null) {
      return { ok: false, message: '这个语种还没登记' }
    }
    const dir = userDataDir()
    saveWikiSettings(dir, { ...loadWikiSettings(dir), language: raw })
    return { ok: true }
  })
  ipcMain.handle(
    CH.wikiChooseLocation,
    async (event, raw: unknown): Promise<WikiLocationChoice> => {
      const roots = Array.isArray(raw)
        ? raw.map(parseProjectRoot).filter((root): root is string => root !== null)
        : []
      const win = BrowserWindow.fromWebContents(event.sender)
      const chosen = await pickPathDialog(win, { properties: ['openDirectory'] })
      if (chosen === null) return { ok: false, cancelled: true }
      const resolved = await resolveWikiLocation({ chosen, projectRoots: roots })
      if (!resolved.ok) return { ok: false, cancelled: false, error: resolved.reason }
      await ensureWikiRootMarker(resolved.location)
      const dir = userDataDir()
      saveWikiSettings(dir, { ...loadWikiSettings(dir), location: resolved.location })
      return { ok: true, location: resolved.location, usedSubdirectory: resolved.usedSubdirectory }
    }
  )
  ipcMain.handle(CH.wikiScanRoot, async (): Promise<WikiRootScan> => {
    const location = wikiRoot()
    if (location === null) return emptyScan(null)
    if (!(await isDirectory(location))) return emptyScan(location)
    return scanWikiRoot(location)
  })
}

function registerCleanup(): void {
  ipcMain.handle(CH.wikiCleanupAll, async (): Promise<WikiCleanupOutcome> => {
    const location = wikiRoot()
    if (location === null) {
      return { ok: false, reason: '还没选 Wiki 存放位置', damaged: [] }
    }
    return cleanupWiki({ root: location, isGenerating: isWikiJobActive() })
  })
  ipcMain.handle(
    CH.wikiCleanupProject,
    async (_event, raw: unknown): Promise<WikiCleanupOutcome> => {
      const projectRoot = parseProjectRoot(raw)
      if (projectRoot === null) {
        return { ok: false, reason: '项目路径不合法', damaged: [] }
      }
      const location = wikiRoot()
      if (location === null) {
        return { ok: false, reason: '还没选 Wiki 存放位置', damaged: [] }
      }
      const projectDir = await resolveProjectDir(location, projectRoot)
      return cleanupWiki({
        root: location,
        projectDir,
        isGenerating: isWikiJobActive()
      })
    }
  )
}

function registerFiles(): void {
  ipcMain.handle(CH.wikiOpenDoc, async (_event, raw: unknown): Promise<WikiFileOpResult> => {
    const target = await docPath(raw)
    if ('error' in target) return { ok: false, message: target.error }
    const failed = await shell.openPath(target.path)
    return failed === '' ? { ok: true } : { ok: false, message: failed }
  })
  ipcMain.handle(CH.wikiRevealDoc, async (_event, raw: unknown): Promise<WikiFileOpResult> => {
    const target = await docPath(raw)
    if ('error' in target) return { ok: false, message: target.error }
    shell.showItemInFolder(target.path)
    return { ok: true }
  })
  ipcMain.handle(CH.wikiOpenLocation, async (): Promise<WikiFileOpResult> => {
    const location = wikiRoot()
    if (location === null) return { ok: false, message: '还没选 Wiki 存放位置' }
    if (!(await isDirectory(location))) return { ok: false, message: 'Wiki 目录不见了' }
    const failed = await shell.openPath(location)
    return failed === '' ? { ok: true } : { ok: false, message: failed }
  })
}

export function registerWikiIpc(): void {
  registerSettings()
  registerCleanup()
  registerFiles()
  ipcMain.handle(CH.wikiProjectState, (_event, raw: unknown) => projectState(raw))
}
