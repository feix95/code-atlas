// 有模型时跑 C1 到 C3,把结果写成目录缓存;没有模型或模型失败就返回 null,规划改走确定性兜底。
// 调用次数有上限,提问本身是纯函数,模型只从 complete 注入。
import type { WikiPlanInput, WikiPlanPage } from './wikiPlanTypes.ts'
import { buildWikiPlan } from './wikiPlan.ts'
import {
  readWikiCatalog,
  resolveCatalog,
  writeWikiCatalog,
  type WikiCatalog,
  type WikiCatalogTheme
} from './wikiCatalogStore.ts'
import { atomsFromPages } from './wikiThemeAtoms.ts'
import { c1Prompt, c2Prompt, c3Prompt, parseC1, parseC2, parseC3 } from './wikiThemePrompt.ts'
import { catalogFromAssignments, type CatalogAssignment } from './wikiThemeCatalog.ts'
import { CHAPTERS } from './wikiSkeleton.ts'

export const THEME_CALL_LIMIT = 15
const BATCH = 40

export interface ThemeComplete {
  (system: string, user: string, schema: Record<string, unknown>): Promise<string | null>
}

function skeletonLeaf(page: WikiPlanPage): boolean {
  return page.basis.some((line) => line.startsWith('骨架'))
}

function atomRefs(
  input: WikiPlanInput
): { atomId: string; membersKey: string; page: WikiPlanPage }[] {
  const preview = buildWikiPlan(input, null)
  return preview.pages
    .filter((page) => page.kind === 'leaf' && !skeletonLeaf(page))
    .map((page) => ({
      atomId: page.id,
      membersKey: page.members
        .filter((member) => member.role === 'primary')
        .map((member) => member.path)
        .sort()
        .join('\n'),
      page
    }))
}

async function ask(
  complete: ThemeComplete,
  prompt: { system: string; user: string; schema: Record<string, unknown> },
  calls: { n: number },
  onProgress?: (done: number, total: number) => void
): Promise<string | null> {
  if (calls.n >= THEME_CALL_LIMIT) return null
  calls.n += 1
  onProgress?.(calls.n, THEME_CALL_LIMIT)
  const user = prompt.user.length > 24_000 ? prompt.user.slice(0, 24_000) : prompt.user
  return complete(prompt.system, user, prompt.schema)
}

/**
 * 指纹对得上就直接交缓存。只有少量原子变化时交修补后的缓存。
 * force 或缓存不能用、并且给了 complete,才重新请模型。模型没答好返回 null。
 */
export async function ensureWikiCatalog(options: {
  projectDir: string
  input: WikiPlanInput
  model: string
  force?: boolean
  complete?: ThemeComplete
  onProgress?: (done: number, total: number) => void
}): Promise<WikiCatalog | null> {
  const stored = await readWikiCatalog(options.projectDir)
  const refs = atomRefs(options.input)
  if (options.force !== true) {
    const resolved = resolveCatalog(stored, refs)
    if (resolved) {
      if (resolved !== stored) await writeWikiCatalog(options.projectDir, resolved)
      return resolved
    }
  }
  if (!options.complete) return null
  const preview = buildWikiPlan(options.input, null)
  const atoms = atomsFromPages(
    preview.pages.filter((page) => page.kind === 'leaf' && !skeletonLeaf(page))
  )
  if (atoms.length === 0) return null
  const categories = Object.values(CHAPTERS).map((chapter) => chapter.slug)
  const calls = { n: 0 }
  const c1 = await ask(options.complete, c1Prompt(atoms, categories), calls, options.onProgress)
  const themes = c1 === null ? null : parseC1(c1)
  if (themes === null) return null
  const themeRows: WikiCatalogTheme[] = themes.map((theme) => ({
    ...theme,
    parent: CHAPTERS.features.slug
  }))
  const allowed = new Set<string>([...categories, ...themes.map((theme) => theme.slug)])
  const known = new Set(atoms.map((atom) => atom.id))
  const assigned = new Map<string, CatalogAssignment>()
  for (let offset = 0; offset < atoms.length; offset += BATCH) {
    const batch = atoms.slice(offset, offset + BATCH)
    const text = await ask(
      options.complete,
      c2Prompt(batch, [...allowed]),
      calls,
      options.onProgress
    )
    if (text === null) continue
    const items = parseC2(text, known, allowed)
    if (items === null) continue
    for (const item of items) {
      if (assigned.has(item.atomId)) continue
      const atom = atoms.find((candidate) => candidate.id === item.atomId)!
      assigned.set(item.atomId, {
        category: item.category,
        title: atom.title,
        slug: item.atomId,
        section: null,
        sectionTitle: null,
        prompt: ''
      })
    }
  }
  const byCategory = new Map<string, typeof atoms>()
  for (const atom of atoms) {
    const hit = assigned.get(atom.id)
    if (!hit || !themes.some((theme) => theme.slug === hit.category)) continue
    const list = byCategory.get(hit.category) ?? []
    list.push(atom)
    byCategory.set(hit.category, list)
  }
  for (const [slug, group] of byCategory) {
    if (group.length <= 8 && group.length > 0) {
      const text = await ask(
        options.complete,
        c3Prompt(themes.find((theme) => theme.slug === slug)?.title ?? slug, group),
        calls,
        options.onProgress
      )
      const parsed = text === null ? null : parseC3(text, known)
      if (parsed === null) continue
      applyPages(parsed, assigned, new Map())
      continue
    }
    if (group.length > 8) {
      const text = await ask(
        options.complete,
        c3Prompt(themes.find((theme) => theme.slug === slug)?.title ?? slug, group),
        calls,
        options.onProgress
      )
      const parsed = text === null ? null : parseC3(text, known)
      if (parsed === null) continue
      const sectionTitle = new Map(parsed.sections.map((section) => [section.slug, section.title]))
      applyPages(parsed, assigned, sectionTitle)
    }
  }
  const catalog = catalogFromAssignments(options.model, atoms, themeRows, assigned)
  await writeWikiCatalog(options.projectDir, catalog)
  return catalog
}

function applyPages(
  parsed: {
    pages: { atomId: string; title: string; slug: string; section: string; prompt: string }[]
  },
  assigned: Map<string, CatalogAssignment>,
  sectionTitle: Map<string, string>
): void {
  for (const page of parsed.pages) {
    const hit = assigned.get(page.atomId)
    if (!hit) continue
    hit.title = page.title
    hit.slug = page.slug
    hit.prompt = page.prompt
    hit.section = page.section === '' ? null : page.section
    hit.sectionTitle = page.section === '' ? null : (sectionTitle.get(page.section) ?? null)
  }
}
