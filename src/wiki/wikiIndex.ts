// 仓库 Wiki 目录页:程序生成,不调用模型;列出项目、语种、模型、生成时间与各页相对链接。
// 与 MD 页头共用 wikiCopy 的固定文案;链接相对 README 所在的语种目录计算。
import { join } from 'node:path'
import { wikiCopy, wikiLanguageLabel } from '../ai/wikiCopy.ts'
import {
  languageDir,
  pageFileExists,
  WIKI_README,
  writeFileAtomic,
  type WikiPageKind,
  type WikiPageRecord
} from './wikiStore.ts'
import type { WikiPageSource } from '../shared/wikiTypes.ts'

export interface WikiIndexPage {
  kind: WikiPageKind
  /** 记账里的 AI 名称,没有时由调用方回退程序名 */
  name: string
  /** 相对语种目录的 MD 路径 */
  file: string
}

export interface WikiIndexInput {
  projectName: string
  language: string
  model: string
  generatedAt: string
  pages: readonly WikiIndexPage[]
}

function formatTime(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso)
  return match ? `${match[1]} ${match[2]}` : iso
}

/** 相对链接保留中文可读性,只转义会截断目标或破坏语法的字符 */
export function wikiIndexLink(file: string): string {
  const escaped = file
    .replaceAll('%', '%25')
    .replaceAll(' ', '%20')
    .replaceAll('#', '%23')
    .replaceAll('?', '%3F')
    .replaceAll('(', '%28')
    .replaceAll(')', '%29')
  return `./${escaped}`
}

function pageSection(title: string, pages: readonly WikiIndexPage[]): string[] {
  if (pages.length === 0) return []
  return [
    `## ${title}`,
    '',
    ...pages.map((page) => `- [${page.name}](${wikiIndexLink(page.file)})`),
    ''
  ]
}

export function renderWikiIndex(input: WikiIndexInput): string {
  const copy = wikiCopy(input.language)
  const lines = [
    `# ${copy.wikiTitle}`,
    '',
    `- ${copy.project}: ${input.projectName}`,
    `- ${copy.language}: ${wikiLanguageLabel(input.language)}`,
    `- ${copy.model}: ${input.model}`,
    `- ${copy.generatedAt}: ${formatTime(input.generatedAt)}`,
    ''
  ]
  lines.push(
    ...pageSection(
      copy.module,
      input.pages.filter((page) => page.kind === 'module')
    ),
    ...pageSection(
      copy.group,
      input.pages.filter((page) => page.kind === 'group')
    )
  )
  return `${lines.join('\n').trimEnd()}\n`
}

export async function writeWikiIndex(projectDir: string, input: WikiIndexInput): Promise<void> {
  const file = join(languageDir(projectDir, input.language), WIKI_README)
  await writeFileAtomic(file, renderWikiIndex(input))
}

export interface WikiIndexRefreshInput {
  projectDir: string
  projectName: string
  language: string
  model: string
  generatedAt: string
  sources: readonly WikiPageSource[]
  records: Record<string, WikiPageRecord>
}

/**
 * 目录页在整轮末尾重写:按生成顺序收已完成且文件还在的页,失败或缺失的不进索引。
 * 空目录(一页都没成)不落 README,免得留下只有表头的空壳。
 */
export async function refreshWikiIndex(input: WikiIndexRefreshInput): Promise<void> {
  const pages: WikiIndexPage[] = []
  for (const source of input.sources) {
    const record = input.records[source.pageId]
    if (record?.status !== 'done') continue
    if (!(await pageFileExists(input.projectDir, input.language, record))) continue
    pages.push({ kind: record.kind, name: record.name, file: record.file })
  }
  if (pages.length === 0) return
  await writeWikiIndex(input.projectDir, {
    projectName: input.projectName,
    language: input.language,
    model: input.model,
    generatedAt: input.generatedAt,
    pages
  })
}
