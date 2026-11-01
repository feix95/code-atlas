// Wiki 目录与记账:项目目录防重名、文件名清洗、MD 原子写、隐藏 state.json 读写、文件缺失识别。
// 记账是唯一可信的「哪些文件是本应用生成的」清单;清理与改名都只认它,用户自己放的文件不碰。
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { translateLang } from '../shared/translateLangs.ts'

export const WIKI_STATE_DIR = '.codeatlas'
export const WIKI_STATE_FILE = 'state.json'
export const WIKI_README = 'README.md'
export const WIKI_PAGE_DIRS = { module: '模块', group: '未归类' } as const

export type WikiPageKind = keyof typeof WIKI_PAGE_DIRS
export type WikiPageStatus = 'done' | 'stale' | 'missing' | 'failed' | 'cancelled'

export interface WikiPageRecord {
  /** 模块 id(m:)或散件组 id(g:) */
  pageId: string
  kind: WikiPageKind
  /** 相对语种目录的 MD 路径,如 模块/名称.md */
  file: string
  inputHash: string
  promptVersion: number
  model: string
  generatedAt: string
  status: WikiPageStatus
  /** 生成时的 AI 名称,改名时用来对比 */
  name: string
  truncated?: boolean
}

export interface WikiLanguageState {
  code: string
  label: string
  pages: Record<string, WikiPageRecord>
}

export interface WikiState {
  schema: 1
  /** 项目根绝对路径;只存本机,不作为提示词内容 */
  projectRoot: string
  projectDir: string
  languages: Record<string, WikiLanguageState>
}

export type ReadStateResult =
  { status: 'missing' } | { status: 'ok'; state: WikiState } | { status: 'damaged'; reason: string }

const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const PAGE_STATUSES = new Set<WikiPageStatus>(['done', 'stale', 'missing', 'failed', 'cancelled'])

const ILLEGAL_NAME_CHARS = '<>:"/\\|?*'

function replaceIllegalChars(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    out += code < 0x20 || ILLEGAL_NAME_CHARS.includes(ch) ? '-' : ch
  }
  return out
}

export function sanitizeFileName(raw: string): string {
  const replaced = replaceIllegalChars(raw).trim()
  const trimmed = replaced.replace(/[. ]+$/g, '')
  if (trimmed === '') return 'untitled'
  const safe = RESERVED_NAME.test(trimmed) ? `_${trimmed}` : trimmed
  return safe.slice(0, 80)
}

export function shortProjectCode(projectRoot: string): string {
  return createHash('sha256').update(projectRoot, 'utf8').digest('hex').slice(0, 4)
}

function foldCase(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function isSamePath(a: string, b: string): boolean {
  return foldCase(a) === foldCase(b)
}

async function isEmptyDir(dir: string): Promise<boolean> {
  const entries = await fs.readdir(dir).catch(() => null)
  return entries !== null && entries.length === 0
}

/** 项目目录:不重名用项目名;重名且记账属于别的项目时加短编号 */
export async function resolveProjectDir(wikiRoot: string, projectRoot: string): Promise<string> {
  const base = sanitizeFileName(basename(projectRoot)) || 'project'
  const short = `${base}-${shortProjectCode(projectRoot)}`
  const names = [base, short]
  for (let i = 2; i <= 20; i++) names.push(`${short}-${i}`)
  for (const name of names) {
    const dir = join(wikiRoot, name)
    const stat = await fs.stat(dir).catch(() => null)
    if (stat === null) return dir
    if (!stat.isDirectory()) continue
    const state = await readWikiState(dir)
    if (state.status === 'ok' && isSamePath(state.state.projectRoot, projectRoot)) return dir
    if (state.status === 'missing' && (await isEmptyDir(dir))) return dir
  }
  return join(wikiRoot, `${short}-${Date.now().toString(36)}`)
}

export function languageDirLabel(code: string): string {
  return sanitizeFileName(translateLang(code)?.label ?? code)
}

export function languageDir(projectDir: string, languageCode: string): string {
  return join(projectDir, languageDirLabel(languageCode))
}

function isSafePageFile(file: string): boolean {
  const parts = file.split('/')
  return (
    parts.length === 2 &&
    (parts[0] === WIKI_PAGE_DIRS.module || parts[0] === WIKI_PAGE_DIRS.group) &&
    parts[1].endsWith('.md') &&
    parts[1].length > 3 &&
    !file.includes('..') &&
    !file.includes('\\')
  )
}

export function pageFilePath(
  projectDir: string,
  languageCode: string,
  record: Pick<WikiPageRecord, 'file'>
): string {
  return join(languageDir(projectDir, languageCode), record.file)
}

/** 给一页挑相对路径:同页沿用原名,撞名加页 id 短编号,再撞就追加序号 */
export function allocatePageFile(
  existing: Iterable<WikiPageRecord>,
  kind: WikiPageKind,
  name: string,
  pageId: string
): string {
  const records = [...existing]
  const candidate = `${WIKI_PAGE_DIRS[kind]}/${sanitizeFileName(name)}.md`
  const own = records.find((record) => record.pageId === pageId)
  if (own?.file === candidate) return candidate
  const used = new Set(
    records.filter((record) => record.pageId !== pageId).map((record) => record.file.toLowerCase())
  )
  if (!used.has(candidate.toLowerCase())) return candidate
  const suffix = shortProjectCode(pageId)
  const withSuffix = `${WIKI_PAGE_DIRS[kind]}/${sanitizeFileName(name)}-${suffix}.md`
  if (!used.has(withSuffix.toLowerCase())) return withSuffix
  for (let i = 2; ; i++) {
    const next = `${WIKI_PAGE_DIRS[kind]}/${sanitizeFileName(name)}-${suffix}-${i}.md`
    if (!used.has(next.toLowerCase())) return next
  }
}

export async function writeFileAtomic(file: string, content: string): Promise<void> {
  const dir = dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const temp = join(
    dir,
    `.${basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  )
  try {
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, file)
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw err
  }
}

export async function savePage(input: {
  projectDir: string
  languageCode: string
  record: WikiPageRecord
  markdown: string
  /** 改名前的旧文件;与新路径不同时写新删旧 */
  previousFile?: string | null
}): Promise<void> {
  await writeFileAtomic(
    pageFilePath(input.projectDir, input.languageCode, input.record),
    input.markdown
  )
  if (input.previousFile && input.previousFile !== input.record.file) {
    await removePageFile(input.projectDir, input.languageCode, input.previousFile)
  }
}

export async function pageFileExists(
  projectDir: string,
  languageCode: string,
  record: Pick<WikiPageRecord, 'file'>
): Promise<boolean> {
  if (!isSafePageFile(record.file)) return false
  return fs.access(pageFilePath(projectDir, languageCode, record)).then(
    () => true,
    () => false
  )
}

/** 删除记账里的一页文件;只动模块/未归类目录,空目录顺手收掉 */
export async function removePageFile(
  projectDir: string,
  languageCode: string,
  file: string
): Promise<void> {
  if (!isSafePageFile(file)) return
  const root = languageDir(projectDir, languageCode)
  const target = join(root, file)
  const rel = relative(root, target)
  if (rel.startsWith('..')) return
  await fs.rm(target, { force: true })
  await fs.rmdir(dirname(target)).catch(() => undefined)
}

export function createWikiState(projectRoot: string, projectDir: string): WikiState {
  return { schema: 1, projectRoot, projectDir, languages: {} }
}

function stateFilePath(projectDir: string): string {
  return join(projectDir, WIKI_STATE_DIR, WIKI_STATE_FILE)
}

export async function writeWikiState(projectDir: string, state: WikiState): Promise<void> {
  await writeFileAtomic(stateFilePath(projectDir), JSON.stringify(state, null, 2))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sanitizePage(raw: unknown, pageId: string): WikiPageRecord | null {
  if (!isObject(raw) || raw.pageId !== pageId) return null
  if (raw.kind !== 'module' && raw.kind !== 'group') return null
  if (typeof raw.file !== 'string' || !isSafePageFile(raw.file)) return null
  if (typeof raw.inputHash !== 'string' || typeof raw.promptVersion !== 'number') return null
  if (typeof raw.model !== 'string' || typeof raw.generatedAt !== 'string') return null
  if (typeof raw.status !== 'string' || !PAGE_STATUSES.has(raw.status as WikiPageStatus))
    return null
  if (typeof raw.name !== 'string') return null
  const record: WikiPageRecord = {
    pageId,
    kind: raw.kind,
    file: raw.file,
    inputHash: raw.inputHash,
    promptVersion: raw.promptVersion,
    model: raw.model,
    generatedAt: raw.generatedAt,
    status: raw.status as WikiPageStatus,
    name: raw.name
  }
  if (raw.truncated === true) record.truncated = true
  return record
}

function sanitizeState(raw: unknown): WikiState | null {
  if (!isObject(raw) || raw.schema !== 1) return null
  if (typeof raw.projectRoot !== 'string' || typeof raw.projectDir !== 'string') return null
  if (!isObject(raw.languages)) return null
  const languages: Record<string, WikiLanguageState> = {}
  for (const [code, value] of Object.entries(raw.languages)) {
    if (!isObject(value) || !isObject(value.pages)) continue
    const pages: Record<string, WikiPageRecord> = {}
    for (const [pageId, pageRaw] of Object.entries(value.pages)) {
      const page = sanitizePage(pageRaw, pageId)
      if (page) pages[pageId] = page
    }
    languages[code] = {
      code,
      label: typeof value.label === 'string' ? value.label : languageDirLabel(code),
      pages
    }
  }
  return {
    schema: 1,
    projectRoot: raw.projectRoot,
    projectDir: raw.projectDir,
    languages
  }
}

export async function readWikiState(projectDir: string): Promise<ReadStateResult> {
  const raw = await fs
    .readFile(stateFilePath(projectDir), 'utf8')
    .catch((err: NodeJS.ErrnoException) => err)
  if (raw instanceof Error) {
    if (raw.code === 'ENOENT') return { status: 'missing' }
    return { status: 'damaged', reason: `记账读不了:${raw.code ?? '未知错误'}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'damaged', reason: '记账不是合法 JSON' }
  }
  const state = sanitizeState(parsed)
  return state === null ? { status: 'damaged', reason: '记账结构不认识' } : { status: 'ok', state }
}
