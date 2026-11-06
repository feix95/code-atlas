// 记账第二版:主题树规划落盘、旧页转 legacy 区、新页嵌套路径。
// 读取端双版本并存:第一版记账原样可读,首次新管线生成时才升版写入;
// 旧页文件不搬动,新页按主题树路径写入,两套路径安全校验互不放宽。
import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import {
  WIKI_STATE_DIR,
  WIKI_STATE_FILE,
  cleanString,
  cleanStringList,
  isObject,
  languageDir,
  languageDirLabel,
  sanitizeWikiStateV1,
  writeFileAtomic,
  type WikiPageRecord,
  type WikiState
} from './wikiStore.ts'
import { isSafePageFileV2 } from './wikiPlanStore.ts'

export const WIKI_LEDGER_DIR = 'ledger'
export const WIKI_NOTE_LEDGER_FILE = 'wiki-note-ledger.json'

export type WikiPageKindV2 = 'leaf' | 'overview' | 'root'
export type WikiPageStatusV2 = 'done' | 'stale' | 'missing' | 'failed' | 'cancelled' | 'planned'
export type WikiNameSource = 'locked' | 'program'
export type WikiLanguageOrigin = 'generated' | 'translated'

export interface WikiMemberSnapshot {
  path: string
  role: 'primary' | 'supporting' | 'attached' | 'reference'
  /** 生成时的成员内容哈希;事实层未取得时为 null */
  contentHash: string | null
}

export interface WikiPageRecordV2 {
  pageId: string
  kind: WikiPageKindV2
  /** 相对语种目录的嵌套路径,如 主题/子主题/页面.md */
  file: string
  name: string
  nameSource: WikiNameSource
  status: WikiPageStatusV2
  model: string
  generatedAt: string
  members: WikiMemberSnapshot[]
  /** 预算裁剪与降级的逐项记录;没有裁剪时为空数组,不静默 */
  budgetNotes: string[]
  summary?: string
  tags?: string[]
  keyFiles?: string[]
  excerpt?: string
  /** 父页的内容指纹:由下属页面的名称与摘要算出,变了即视为过期 */
  inputHash?: string
}

export interface WikiLanguageStateV2 {
  code: string
  label: string
  origin: WikiLanguageOrigin
  pages: Record<string, WikiPageRecordV2>
  /** 第一版旧页记录:只读展示,对应新页生成后逐条移除 */
  legacy: Record<string, WikiPageRecord>
}

export interface WikiStateV2 {
  schema: 2
  projectRoot: string
  projectDir: string
  /** 规划文件登记:相对项目文件夹的路径与规划版本;尚未规划时为 null */
  planRef: { path: string; version: number } | null
  /** 账本区登记:相对项目文件夹的目录,清理时一并删除 */
  ledgerDir: string
  languages: Record<string, WikiLanguageStateV2>
}

export type ReadStateAnyResult =
  | { status: 'missing' }
  | { status: 'damaged'; reason: string }
  | { status: 'ok'; version: 1; state: WikiState }
  | { status: 'ok'; version: 2; state: WikiStateV2 }

const PAGE_KINDS_V2 = new Set<WikiPageKindV2>(['leaf', 'overview', 'root'])
const PAGE_STATUSES_V2 = new Set<WikiPageStatusV2>([
  'done',
  'stale',
  'missing',
  'failed',
  'cancelled',
  'planned'
])
const MEMBER_ROLES = new Set(['primary', 'supporting', 'attached', 'reference'])

function stateFilePath(projectDir: string): string {
  return join(projectDir, WIKI_STATE_DIR, WIKI_STATE_FILE)
}

export function wikiLedgerDirPath(projectDir: string): string {
  return join(projectDir, WIKI_STATE_DIR, WIKI_LEDGER_DIR)
}

export function noteLedgerFilePath(projectDir: string): string {
  return join(wikiLedgerDirPath(projectDir), WIKI_NOTE_LEDGER_FILE)
}

export function pageFilePathV2(
  projectDir: string,
  languageCode: string,
  record: Pick<WikiPageRecordV2, 'file'>
): string {
  return join(languageDir(projectDir, languageCode), record.file)
}

/** 删除记账里的一页新页文件;只动校验通过的嵌套路径,变空的父目录逐层收掉 */
export async function removePageFileV2(
  projectDir: string,
  languageCode: string,
  file: string
): Promise<void> {
  if (!isSafePageFileV2(file)) return
  const root = languageDir(projectDir, languageCode)
  const target = join(root, file)
  const rel = relative(root, target)
  if (rel.startsWith('..')) return
  await fs.rm(target, { force: true })
  let dir = dirname(target)
  while (dir !== root && dir.startsWith(root)) {
    const removed = await fs
      .rmdir(dir)
      .then(() => true)
      .catch(() => false)
    if (!removed) break
    dir = dirname(dir)
  }
}

export function createWikiStateV2(projectRoot: string, projectDir: string): WikiStateV2 {
  return {
    schema: 2,
    projectRoot,
    projectDir,
    planRef: null,
    ledgerDir: `${WIKI_STATE_DIR}/${WIKI_LEDGER_DIR}`,
    languages: {}
  }
}

/** 第一版记账升版:页面记录整体转入 legacy 区,新页区留空,只读不改文件 */
export function upgradeStateV1toV2(state: WikiState): WikiStateV2 {
  const upgraded = createWikiStateV2(state.projectRoot, state.projectDir)
  for (const [code, language] of Object.entries(state.languages)) {
    upgraded.languages[code] = {
      code,
      label: language.label,
      origin: 'generated',
      pages: {},
      legacy: { ...language.pages }
    }
  }
  return upgraded
}

function sanitizeMember(raw: unknown): WikiMemberSnapshot | null {
  if (!isObject(raw) || typeof raw.path !== 'string' || raw.path === '') return null
  if (typeof raw.role !== 'string' || !MEMBER_ROLES.has(raw.role)) return null
  return {
    path: raw.path,
    role: raw.role as WikiMemberSnapshot['role'],
    contentHash: typeof raw.contentHash === 'string' ? raw.contentHash : null
  }
}

function sanitizePageV2(raw: unknown, pageId: string): WikiPageRecordV2 | null {
  if (!isObject(raw) || raw.pageId !== pageId) return null
  if (typeof raw.kind !== 'string' || !PAGE_KINDS_V2.has(raw.kind as WikiPageKindV2)) return null
  if (typeof raw.file !== 'string' || !isSafePageFileV2(raw.file)) return null
  if (typeof raw.name !== 'string' || typeof raw.model !== 'string') return null
  if (typeof raw.generatedAt !== 'string') return null
  if (typeof raw.status !== 'string' || !PAGE_STATUSES_V2.has(raw.status as WikiPageStatusV2))
    return null
  if (!Array.isArray(raw.members)) return null
  const members: WikiMemberSnapshot[] = []
  for (const item of raw.members) {
    const member = sanitizeMember(item)
    if (member === null) return null
    members.push(member)
  }
  const record: WikiPageRecordV2 = {
    pageId,
    kind: raw.kind as WikiPageKindV2,
    file: raw.file,
    name: raw.name,
    nameSource: raw.nameSource === 'locked' ? 'locked' : 'program',
    status: raw.status as WikiPageStatusV2,
    model: raw.model,
    generatedAt: raw.generatedAt,
    members,
    budgetNotes: cleanStringList(raw.budgetNotes, 40, 300) ?? []
  }
  const summary = cleanString(raw.summary, 120)
  const tags = cleanStringList(raw.tags, 5, 24)
  const keyFiles = cleanStringList(raw.keyFiles, 5, 1024)
  const excerpt = cleanString(raw.excerpt, 400)
  const inputHash = cleanString(raw.inputHash, 64)
  if (summary !== null) record.summary = summary
  if (tags !== null) record.tags = tags
  if (keyFiles !== null) record.keyFiles = keyFiles
  if (excerpt !== null) record.excerpt = excerpt
  if (inputHash !== null) record.inputHash = inputHash
  return record
}

function sanitizeStateV2(raw: unknown): WikiStateV2 | null {
  if (!isObject(raw) || raw.schema !== 2) return null
  if (typeof raw.projectRoot !== 'string' || typeof raw.projectDir !== 'string') return null
  if (!isObject(raw.languages)) return null
  const languages: Record<string, WikiLanguageStateV2> = {}
  for (const [code, value] of Object.entries(raw.languages)) {
    if (!isObject(value) || !isObject(value.pages)) continue
    const pages: Record<string, WikiPageRecordV2> = {}
    for (const [pageId, pageRaw] of Object.entries(value.pages)) {
      const page = sanitizePageV2(pageRaw, pageId)
      if (page) pages[pageId] = page
    }
    const legacy: Record<string, WikiPageRecord> = {}
    if (isObject(value.legacy)) {
      // legacy 区沿用第一版清洗口径:包一层假的第一版语言结构复用其清洗
      const wrapped = sanitizeWikiStateV1({
        schema: 1,
        projectRoot: raw.projectRoot,
        projectDir: raw.projectDir,
        languages: { [code]: { code, label: value.label, pages: value.legacy } }
      })
      if (wrapped !== null) Object.assign(legacy, wrapped.languages[code]?.pages ?? {})
    }
    languages[code] = {
      code,
      label: typeof value.label === 'string' ? value.label : languageDirLabel(code),
      origin: value.origin === 'translated' ? 'translated' : 'generated',
      pages,
      legacy
    }
  }
  const planRef =
    isObject(raw.planRef) &&
    typeof raw.planRef.path === 'string' &&
    typeof raw.planRef.version === 'number'
      ? { path: raw.planRef.path, version: raw.planRef.version }
      : null
  return {
    schema: 2,
    projectRoot: raw.projectRoot,
    projectDir: raw.projectDir,
    planRef,
    ledgerDir:
      typeof raw.ledgerDir === 'string' && raw.ledgerDir !== ''
        ? raw.ledgerDir
        : `${WIKI_STATE_DIR}/${WIKI_LEDGER_DIR}`,
    languages
  }
}

/** 双版本读取:第一版走旧清洗,第二版走新清洗,只有两边都不认才算损坏 */
export async function readWikiStateAny(projectDir: string): Promise<ReadStateAnyResult> {
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
  if (isObject(parsed) && parsed.schema === 2) {
    const state = sanitizeStateV2(parsed)
    return state === null
      ? { status: 'damaged', reason: '记账结构不认识' }
      : { status: 'ok', version: 2, state }
  }
  const stateV1 = sanitizeWikiStateV1(parsed)
  return stateV1 === null
    ? { status: 'damaged', reason: '记账结构不认识' }
    : { status: 'ok', version: 1, state: stateV1 }
}

export async function writeWikiStateV2(projectDir: string, state: WikiStateV2): Promise<void> {
  await writeFileAtomic(stateFilePath(projectDir), JSON.stringify(state, null, 2))
}
