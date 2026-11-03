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
  WikiPanelStateResult,
  WikiProjectStateResult,
  WikiRootScan
} from '../shared/wikiTypes.ts'
import { getFactFileCount, getFileFact } from '../depgraph/factCache.ts'
import { pickPathDialog } from './atlasWindow.ts'
import { userDataDir } from './paths.ts'
import { parseProjectRoot, parseWikiPanelRequest } from './wikiRequest.ts'
import { resolveWikiDocPath } from './wikiDocPath.ts'
import { isWikiJobActive } from './wikiRun.ts'
import { isWikiJobV2Active } from './wikiRunV2.ts'
import { ensureWikiRootMarker, resolveWikiLocation } from '../wiki/wikiLocation.ts'
import { loadWikiSettings, saveWikiSettings } from '../wiki/wikiSettings.ts'
import { cleanupWiki, scanWikiRoot } from '../wiki/wikiCleanup.ts'
import { pageFileExists, resolveProjectDir } from '../wiki/wikiStore.ts'
import { pageFilePathV2, readWikiStateAny } from '../wiki/wikiStoreV2.ts'
import { wikiPageInputHash } from '../wiki/wikiPageFacts.ts'
import { panelPageOf } from '../wiki/wikiPanel.ts'

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
  const read = await readWikiStateAny(projectDir)
  if (read.status === 'damaged') {
    return { ok: true, projectDir, damaged: true, languages: [] }
  }
  if (read.status === 'missing') {
    return { ok: true, projectDir, damaged: false, languages: [] }
  }
  if (read.version === 1) {
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
  const languages = await Promise.all(
    Object.values(read.state.languages).map(async (language) => {
      type SummaryPage = {
        pageId: string
        kind: 'module' | 'group'
        name: string
        status: 'done' | 'stale' | 'missing' | 'failed' | 'cancelled'
        file: string
        generatedAt: string
        model: string
        truncated: boolean
        exists: boolean
      }
      const pages: SummaryPage[] = await Promise.all(
        Object.values(language.pages).map(async (record) => {
          const exists = await fs.access(pageFilePathV2(projectDir, language.code, record)).then(
            () => true,
            () => false
          )
          return {
            pageId: record.pageId,
            // 页面类型暂借模块一类展示,进度页口径切换随生成入口切换一并处理;待生成页先按缺失呈现
            kind: 'module' as const,
            name: record.name,
            status:
              record.status === 'done' && !exists
                ? ('missing' as const)
                : record.status === 'planned'
                  ? ('missing' as const)
                  : record.status,
            file: record.file,
            generatedAt: record.generatedAt,
            model: record.model,
            truncated: false,
            exists
          }
        })
      )
      // legacy 旧页并入同一份清单,保持可达;新页在前,旧页在后
      for (const record of Object.values(language.legacy)) {
        const exists = await pageFileExists(projectDir, language.code, record)
        pages.push({
          pageId: record.pageId,
          kind: record.kind,
          name: record.name,
          status: record.status === 'done' && !exists ? ('missing' as const) : record.status,
          file: record.file,
          generatedAt: record.generatedAt,
          model: record.model,
          truncated: record.truncated === true,
          exists
        })
      }
      return { code: language.code, label: language.label, pages }
    })
  )
  return { ok: true, projectDir, damaged: false, languages }
}

/**
 * 侧栏快照:当前语种下每页的 AI 名称、简介、标签与状态。
 * 过期按当前内容哈希重算;分析还没跑完(事实缓存为空)时不判过期,免得整份误报。
 */
async function panelState(raw: unknown): Promise<WikiPanelStateResult> {
  const parsed = parseWikiPanelRequest(raw)
  if (!parsed.ok) return parsed
  const { projectRoot, language, pages } = parsed.request
  if (translateLang(language) === null) return { ok: false, error: '这个语种还没登记' }
  const location = wikiRoot()
  if (location === null) return { ok: true, language, damaged: false, pages: [] }
  const projectDir = await resolveProjectDir(location, projectRoot)
  const read = await readWikiStateAny(projectDir)
  if (read.status === 'damaged') return { ok: true, language, damaged: true, pages: [] }
  const factReady = getFactFileCount(projectRoot) > 0
  const result = await Promise.all(
    pages.map(async (source) => {
      // 第二版记账里,图谱页的记录在 legacy 区(同一套页面标识);新页与图谱页不是同一套标识,不在这里混查
      const record =
        read.status === 'ok'
          ? read.version === 2
            ? read.state.languages[language]?.legacy[source.pageId]
            : read.state.languages[language]?.pages[source.pageId]
          : undefined
      if (!record) return panelPageOf({ source, record, exists: false, currentHash: null })
      const exists = await pageFileExists(projectDir, language, record)
      const currentHash =
        factReady && read.status === 'ok' && read.version === 1
          ? wikiPageInputHash(source, language, (relPath) => getFileFact(projectRoot, relPath))
          : null
      return panelPageOf({ source, record, exists, currentHash })
    })
  )
  return { ok: true, language, damaged: false, pages: result }
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
    return cleanupWiki({ root: location, isGenerating: isWikiJobActive() || isWikiJobV2Active() })
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
        isGenerating: isWikiJobActive() || isWikiJobV2Active()
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
  ipcMain.handle(CH.wikiPanelState, (_event, raw: unknown) => panelState(raw))
}
