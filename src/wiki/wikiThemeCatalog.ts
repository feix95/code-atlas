// 把模型给出的归类收成目录,并落成组装用的落点。坏目录返回 null,调用方改走确定性兜底。
import { WIKI_PLAN_VERSION } from '../shared/wikiTypes.ts'
import type { WikiCatalog, WikiCatalogAtom, WikiCatalogTheme } from './wikiCatalogStore.ts'
import { membersHashOf } from './wikiCatalogStore.ts'
import type { ThemeAtom } from './wikiThemeAtoms.ts'
import type { AtomPlacement } from './wikiThemeCluster.ts'

export interface CatalogAssignment {
  category: string
  title: string
  slug: string
  section: string | null
  sectionTitle: string | null
  prompt: string
}

export function catalogFromAssignments(
  model: string,
  atoms: ThemeAtom[],
  themes: WikiCatalogTheme[],
  assigned: Map<string, CatalogAssignment>
): WikiCatalog {
  const rows: WikiCatalogAtom[] = []
  for (const atom of atoms) {
    const hit = assigned.get(atom.id)
    if (!hit) continue
    rows.push({
      atomId: atom.id,
      membersKey: [...atom.primary].sort().join('\n'),
      category: hit.category,
      section: hit.section,
      sectionTitle: hit.sectionTitle,
      title: hit.title,
      slug: hit.slug,
      prompt: hit.prompt
    })
  }
  const alive = new Set(rows.map((row) => row.category))
  return {
    version: 1,
    planVersion: WIKI_PLAN_VERSION,
    model,
    membersHash: membersHashOf(atoms.map((atom) => [...atom.primary].sort().join('\n'))),
    themes: themes.filter(
      (theme) => alive.has(theme.slug) || rows.some((row) => row.section === theme.slug)
    ),
    atoms: rows
  }
}

/** 少于两个原子的模型主题并回父章。空主题自然消失。 */
export function placementsFromCatalog(
  catalog: WikiCatalog,
  atoms: ThemeAtom[],
  allowed: ReadonlySet<string>
): AtomPlacement[] | null {
  if (catalog.atoms.length === 0 && atoms.length > 0) return null
  const byKey = new Map(catalog.atoms.map((atom) => [atom.membersKey, atom]))
  const byId = new Map(catalog.atoms.map((atom) => [atom.atomId, atom]))
  const themeOf = new Map(catalog.themes.map((theme) => [theme.slug, theme]))
  const draft: AtomPlacement[] = []
  for (const atom of atoms) {
    const key = [...atom.primary].sort().join('\n')
    const hit = byKey.get(key) ?? byId.get(atom.id)
    if (!hit) continue
    const theme = themeOf.get(hit.category)
    if (!allowed.has(hit.category) && theme === undefined) continue
    const chapter = theme ? theme.parent : hit.category
    if (!allowed.has(chapter) && chapter !== 'features') continue
    draft.push({
      atomId: atom.id,
      chapter: allowed.has(chapter) ? chapter : 'features',
      theme: theme ? theme.slug : null,
      themeTitle: theme ? theme.title : null,
      section: hit.section,
      sectionTitle: hit.sectionTitle,
      title: hit.title,
      prompt: hit.prompt === '' ? null : hit.prompt
    })
  }
  const themeCount = new Map<string, number>()
  for (const place of draft) {
    if (place.theme) themeCount.set(place.theme, (themeCount.get(place.theme) ?? 0) + 1)
  }
  for (const place of draft) {
    if (place.theme && (themeCount.get(place.theme) ?? 0) < 2) {
      place.theme = null
      place.themeTitle = null
      place.section = null
      place.sectionTitle = null
    }
  }
  return draft
}
