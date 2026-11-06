// 主题目录缓存:原子成员没怎么变就复用,避免每次打开线索桌都请模型重排。
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { WIKI_PLAN_VERSION } from '../shared/wikiTypes.ts'
import { WIKI_STATE_DIR, isObject, writeFileAtomic } from './wikiStore.ts'

export const WIKI_CATALOG_FILE = 'catalog.json'
/** 原子增删不超过这个比例时,新原子靠亲和挂上,不重新请模型 */
export const CATALOG_PATCH_RATIO = 0.2

export interface WikiCatalogAtom {
  atomId: string
  membersKey: string
  category: string
  section: string | null
  sectionTitle: string | null
  title: string
  slug: string
  prompt: string
}

export interface WikiCatalogTheme {
  slug: string
  title: string
  oneLine: string
  parent: string
}

export interface WikiCatalog {
  version: 1
  planVersion: number
  model: string
  membersHash: string
  themes: WikiCatalogTheme[]
  atoms: WikiCatalogAtom[]
}

export function wikiCatalogFilePath(projectDir: string): string {
  return join(projectDir, WIKI_STATE_DIR, WIKI_CATALOG_FILE)
}

export function membersHashOf(keys: readonly string[]): string {
  return createHash('sha256')
    .update(`${WIKI_PLAN_VERSION}\n${[...keys].sort().join('\n')}`, 'utf8')
    .digest('hex')
}

function asAtom(raw: unknown): WikiCatalogAtom | null {
  if (!isObject(raw)) return null
  if (typeof raw.atomId !== 'string' || typeof raw.membersKey !== 'string') return null
  if (
    typeof raw.category !== 'string' ||
    typeof raw.title !== 'string' ||
    typeof raw.slug !== 'string'
  )
    return null
  return {
    atomId: raw.atomId,
    membersKey: raw.membersKey,
    category: raw.category,
    section: typeof raw.section === 'string' ? raw.section : null,
    sectionTitle: typeof raw.sectionTitle === 'string' ? raw.sectionTitle : null,
    title: raw.title,
    slug: raw.slug,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : ''
  }
}

export function sanitizeCatalog(raw: unknown): WikiCatalog | null {
  if (!isObject(raw) || raw.version !== 1 || raw.planVersion !== WIKI_PLAN_VERSION) return null
  if (typeof raw.model !== 'string' || typeof raw.membersHash !== 'string') return null
  if (!Array.isArray(raw.themes) || !Array.isArray(raw.atoms)) return null
  const themes: WikiCatalogTheme[] = []
  for (const item of raw.themes) {
    if (!isObject(item) || typeof item.slug !== 'string' || typeof item.title !== 'string')
      return null
    themes.push({
      slug: item.slug,
      title: item.title,
      oneLine: typeof item.oneLine === 'string' ? item.oneLine : '',
      parent: typeof item.parent === 'string' ? item.parent : 'features'
    })
  }
  const atoms: WikiCatalogAtom[] = []
  for (const item of raw.atoms) {
    const atom = asAtom(item)
    if (atom === null) return null
    atoms.push(atom)
  }
  return {
    version: 1,
    planVersion: WIKI_PLAN_VERSION,
    model: raw.model,
    membersHash: raw.membersHash,
    themes,
    atoms
  }
}

export async function readWikiCatalog(projectDir: string): Promise<WikiCatalog | null> {
  try {
    const raw = JSON.parse(await fs.readFile(wikiCatalogFilePath(projectDir), 'utf8')) as unknown
    return sanitizeCatalog(raw)
  } catch {
    return null
  }
}

export async function writeWikiCatalog(projectDir: string, catalog: WikiCatalog): Promise<void> {
  await writeFileAtomic(wikiCatalogFilePath(projectDir), JSON.stringify(catalog))
}

export interface CatalogAtomRef {
  atomId: string
  membersKey: string
}

/**
 * 指纹一致就原样用。变了一小部分就只保留还在的原子,新原子留给亲和兜底。
 * 变得太多、规划器版本对不上,返回 null,调用方改走确定性归类或重新请模型。
 */
export function resolveCatalog(
  catalog: WikiCatalog | null,
  atoms: readonly CatalogAtomRef[]
): WikiCatalog | null {
  if (catalog === null || catalog.planVersion !== WIKI_PLAN_VERSION) return null
  const keys = atoms.map((atom) => atom.membersKey)
  const hash = membersHashOf(keys)
  if (catalog.membersHash === hash) return catalog
  const current = new Set(keys)
  const previous = new Set(catalog.atoms.map((atom) => atom.membersKey))
  if (previous.size === 0) return null
  let changed = 0
  for (const key of previous) if (!current.has(key)) changed += 1
  for (const key of current) if (!previous.has(key)) changed += 1
  if (changed / previous.size > CATALOG_PATCH_RATIO) return null
  const kept = catalog.atoms.filter((atom) => current.has(atom.membersKey))
  return { ...catalog, membersHash: hash, atoms: kept }
}
