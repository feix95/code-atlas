// 主题规划的三次提问:出主题、给原子归类、给大主题起中文名。
// 这里只造提示词、约束和修补,不碰模型。坏 JSON 返回 null,调用方改走确定性兜底。
import { atomBrief, type ThemeAtom } from './wikiThemeAtoms.ts'

const C1_SCHEMA = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          slug: { type: 'string' },
          oneLine: { type: 'string' }
        },
        required: ['title', 'slug', 'oneLine']
      }
    }
  },
  required: ['themes']
}

const C2_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { atomId: { type: 'string' }, category: { type: 'string' } },
        required: ['atomId', 'category']
      }
    }
  },
  required: ['items']
}

const C3_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, slug: { type: 'string' } },
        required: ['title', 'slug']
      }
    },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          atomId: { type: 'string' },
          title: { type: 'string' },
          slug: { type: 'string' },
          section: { type: 'string' },
          prompt: { type: 'string' }
        },
        required: ['atomId', 'title', 'slug']
      }
    }
  },
  required: ['pages']
}

export interface ThemePrompt {
  system: string
  user: string
  schema: Record<string, unknown>
}

export function parseModelJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

export function c1Prompt(atoms: ThemeAtom[], categories: readonly string[]): ThemePrompt {
  const lines = atoms.map((atom) => atomBrief(atom)).join('\n')
  return {
    system:
      '你在给一个软件项目规划百科目录。只输出 JSON。主题名用读者能懂的功能说法,不要用文件夹路径,不要用单个源码文件名。',
    user: `下面每行是一个功能块:标识、程序名、主要文件、符号。\n请提出 6 到 12 个功能主题,每个含 title、slug、oneLine。\n原子也可以直接归入这些已有章(用 slug):${categories.join(', ')}\n${lines}`,
    schema: C1_SCHEMA
  }
}

export function c2Prompt(atoms: ThemeAtom[], categories: readonly string[]): ThemePrompt {
  return {
    system: '你在做分类。只输出 JSON,每个原子只能选一个给定类别的 slug。不认识的标识不要编。',
    user: `类别:${categories.join(', ')}\n原子:\n${atoms.map((atom) => atomBrief(atom)).join('\n')}\n输出 items:[{atomId,category}]`,
    schema: C2_SCHEMA
  }
}

export function c3Prompt(title: string, atoms: ThemeAtom[]): ThemePrompt {
  return {
    system: '你在给百科页起中文名并写一句写作提示。只输出 JSON。页名不要用文件夹路径。',
    user: `主题「${title}」下有这些功能块。原子超过 8 个时再分 0 到 4 个二级子章,否则 sections 给空数组。\n每个原子给 title、slug、section(没有就空字符串)、prompt。\n${atoms.map((atom) => atomBrief(atom)).join('\n')}`,
    schema: C3_SCHEMA
  }
}

export interface ParsedTheme {
  title: string
  slug: string
  oneLine: string
}

export function parseC1(text: string): ParsedTheme[] | null {
  const raw = parseModelJson(text)
  if (
    raw === null ||
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { themes?: unknown }).themes)
  ) {
    return null
  }
  const themes: ParsedTheme[] = []
  for (const item of (raw as { themes: unknown[] }).themes) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { title?: unknown; slug?: unknown; oneLine?: unknown }
    if (typeof record.title !== 'string' || record.title.trim() === '') continue
    if (typeof record.slug !== 'string' || record.slug.trim() === '') continue
    themes.push({
      title: record.title.trim(),
      slug: record.slug.trim().toLowerCase(),
      oneLine: typeof record.oneLine === 'string' ? record.oneLine.trim() : ''
    })
  }
  if (themes.length < 6) return null
  return themes.slice(0, 12)
}

export interface ParsedAssign {
  atomId: string
  category: string
}

/** 未知标识丢掉,重复的只留第一次。坏 JSON 返回 null。 */
export function parseC2(
  text: string,
  knownIds: ReadonlySet<string>,
  categories: ReadonlySet<string>
): ParsedAssign[] | null {
  const raw = parseModelJson(text)
  if (
    raw === null ||
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { items?: unknown }).items)
  ) {
    return null
  }
  const seen = new Set<string>()
  const items: ParsedAssign[] = []
  for (const item of (raw as { items: unknown[] }).items) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { atomId?: unknown; category?: unknown }
    if (typeof record.atomId !== 'string' || typeof record.category !== 'string') continue
    if (!knownIds.has(record.atomId) || seen.has(record.atomId)) continue
    if (!categories.has(record.category)) continue
    seen.add(record.atomId)
    items.push({ atomId: record.atomId, category: record.category })
  }
  return items
}

export interface ParsedPage {
  atomId: string
  title: string
  slug: string
  section: string
  prompt: string
}

export interface ParsedC3 {
  sections: { title: string; slug: string }[]
  pages: ParsedPage[]
}

export function parseC3(text: string, knownIds: ReadonlySet<string>): ParsedC3 | null {
  const raw = parseModelJson(text)
  if (
    raw === null ||
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { pages?: unknown }).pages)
  ) {
    return null
  }
  const record = raw as { sections?: unknown; pages: unknown[] }
  const sections: { title: string; slug: string }[] = []
  if (Array.isArray(record.sections)) {
    for (const item of record.sections) {
      if (typeof item !== 'object' || item === null) continue
      const section = item as { title?: unknown; slug?: unknown }
      if (
        typeof section.title !== 'string' ||
        typeof section.slug !== 'string' ||
        section.title.trim() === ''
      )
        continue
      sections.push({ title: section.title.trim(), slug: section.slug.trim().toLowerCase() })
    }
  }
  const seen = new Set<string>()
  const pages: ParsedPage[] = []
  for (const item of record.pages) {
    if (typeof item !== 'object' || item === null) continue
    const page = item as {
      atomId?: unknown
      title?: unknown
      slug?: unknown
      section?: unknown
      prompt?: unknown
    }
    if (typeof page.atomId !== 'string' || !knownIds.has(page.atomId) || seen.has(page.atomId))
      continue
    if (typeof page.title !== 'string' || page.title.trim() === '') continue
    seen.add(page.atomId)
    pages.push({
      atomId: page.atomId,
      title: page.title.trim(),
      slug:
        typeof page.slug === 'string' && page.slug.trim() !== ''
          ? page.slug.trim().toLowerCase()
          : page.atomId,
      section: typeof page.section === 'string' ? page.section.trim().toLowerCase() : '',
      prompt: typeof page.prompt === 'string' ? page.prompt.trim() : ''
    })
  }
  return { sections: sections.slice(0, 4), pages }
}
