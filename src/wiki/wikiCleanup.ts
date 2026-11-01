// Wiki 清理:只删记账登记过的生成文件、程序生成的索引页与记账本身,
// 再顺手收掉因此变空的目录;用户自己放进去的文件和目录一律不碰。
// 记账损坏时整次拒绝,不做「猜着删」。
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { WIKI_MARKER_FILE } from '../shared/wikiTypes.ts'
import { isInsideRoot } from './wikiLocation.ts'
import {
  languageDir,
  pageFilePath,
  readWikiState,
  removePageFile,
  WIKI_README,
  WIKI_STATE_DIR,
  WIKI_STATE_FILE,
  type WikiState
} from './wikiStore.ts'

export interface WikiRootScan {
  projects: number
  /** 记账里的篇数,含尚未生成成功的失败页 */
  pages: number
  /** 实际还在磁盘上的生成文档数 */
  files: number
  bytes: number
  /** 记账损坏的项目目录,清理会整体拒绝 */
  damaged: string[]
}

export interface WikiCleanupOptions {
  /** 已校验过的 Wiki 根 */
  root: string
  /** 只清一个项目;不传则清根下全部项目 */
  projectDir?: string | null
  isGenerating: boolean
}

export type WikiCleanupResult =
  | { ok: true; projects: number; files: number; bytes: number; removedRoot: boolean }
  | { ok: false; reason: string; damaged: string[] }

type CleanupPlan = { dir: string; state: WikiState }

const fail = (reason: string, damaged: string[] = []): WikiCleanupResult => ({
  ok: false,
  reason,
  damaged
})

async function statSafe(path: string) {
  return fs.stat(path).catch(() => null)
}

async function listProjectDirs(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .sort()
}

/** 只统计，不动文件;确认弹窗与设置卡片用它算篇数、占用与损坏项目 */
export async function scanWikiRoot(root: string): Promise<WikiRootScan> {
  const scan: WikiRootScan = { projects: 0, pages: 0, files: 0, bytes: 0, damaged: [] }
  for (const dir of await listProjectDirs(root)) {
    const read = await readWikiState(dir)
    if (read.status === 'damaged') {
      scan.damaged.push(dir)
      continue
    }
    if (read.status === 'missing') continue
    scan.projects += 1
    for (const language of Object.values(read.state.languages)) {
      for (const record of Object.values(language.pages)) {
        scan.pages += 1
        const stat = await statSafe(pageFilePath(dir, language.code, record))
        if (stat?.isFile()) {
          scan.files += 1
          scan.bytes += stat.size
        }
      }
    }
  }
  return scan
}

async function removeGeneratedFile(
  projectDir: string,
  languageCode: string,
  file: string
): Promise<{ files: number; bytes: number }> {
  const stat = await statSafe(pageFilePath(projectDir, languageCode, { file }))
  if (!stat?.isFile()) return { files: 0, bytes: 0 }
  await removePageFile(projectDir, languageCode, file)
  return { files: 1, bytes: stat.size }
}

/** 记账没登记索引页,但 README.md 是程序生成的固定入口,随语种一起清 */
async function removeIndexPage(
  projectDir: string,
  languageCode: string
): Promise<{ files: number; bytes: number }> {
  const file = join(languageDir(projectDir, languageCode), WIKI_README)
  const stat = await statSafe(file)
  if (!stat?.isFile()) return { files: 0, bytes: 0 }
  await fs.rm(file, { force: true })
  return { files: 1, bytes: stat.size }
}

async function cleanLedgerProject(plan: CleanupPlan): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  for (const language of Object.values(plan.state.languages)) {
    for (const record of Object.values(language.pages)) {
      const removed = await removeGeneratedFile(plan.dir, language.code, record.file)
      files += removed.files
      bytes += removed.bytes
    }
    const index = await removeIndexPage(plan.dir, language.code)
    files += index.files
    bytes += index.bytes
    // 生成目录只按语种标签建;空目录收掉,用户另建的目录不动
    await fs.rmdir(languageDir(plan.dir, language.code)).catch(() => undefined)
  }
  await fs.rm(join(plan.dir, WIKI_STATE_DIR, WIKI_STATE_FILE), { force: true })
  await fs.rmdir(join(plan.dir, WIKI_STATE_DIR)).catch(() => undefined)
  await fs.rmdir(plan.dir).catch(() => undefined)
  return { files, bytes }
}

/** 根目录只剩标记文件时连标记和根一起收掉;还有用户文件就原样留着 */
async function removeRootIfOwned(root: string): Promise<boolean> {
  const entries = await fs.readdir(root).catch(() => null)
  if (entries === null || !entries.includes(WIKI_MARKER_FILE)) return false
  if (entries.some((entry) => entry !== WIKI_MARKER_FILE)) return false
  await fs.rm(join(root, WIKI_MARKER_FILE), { force: true })
  await fs.rmdir(root).catch(() => undefined)
  return true
}

async function planCleanup(
  options: WikiCleanupOptions
): Promise<CleanupPlan[] | WikiCleanupResult> {
  if (options.projectDir) {
    const target = resolve(options.projectDir)
    if (target === resolve(options.root) || !isInsideRoot(target, options.root)) {
      return fail('只清理 Wiki 根目录里的项目文件夹')
    }
    const read = await readWikiState(target)
    if (read.status === 'damaged') return fail('记录损坏,无法判断哪些文件是本应用生成的', [target])
    return read.status === 'ok' ? [{ dir: target, state: read.state }] : []
  }
  const plans: CleanupPlan[] = []
  const damaged: string[] = []
  for (const dir of await listProjectDirs(options.root)) {
    const read = await readWikiState(dir)
    if (read.status === 'damaged') damaged.push(dir)
    else if (read.status === 'ok') plans.push({ dir, state: read.state })
  }
  return damaged.length > 0 ? fail('记录损坏,无法判断哪些文件是本应用生成的', damaged) : plans
}

/** 清全部项目或单个项目;先生成计划,任何项目记账损坏都不动手 */
export async function cleanupWiki(options: WikiCleanupOptions): Promise<WikiCleanupResult> {
  if (options.isGenerating) return fail('生成任务进行中,先取消再清理')
  const rootStat = await statSafe(options.root)
  if (!rootStat?.isDirectory()) return fail('Wiki 目录不见了,可能已被移动或删除')

  const planned = await planCleanup(options)
  if (!Array.isArray(planned)) return planned

  let files = 0
  let bytes = 0
  let projects = 0
  for (const plan of planned) {
    const removed = await cleanLedgerProject(plan)
    files += removed.files
    bytes += removed.bytes
    projects += 1
  }
  const removedRoot = options.projectDir == null ? await removeRootIfOwned(options.root) : false
  return { ok: true, projects, files, bytes, removedRoot }
}
