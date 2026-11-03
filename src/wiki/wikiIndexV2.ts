// 第二版目录页:按主题树渲染,程序生成不调用模型。
// 已生成页给链接,规划内未生成页标待生成,legacy 旧页单列一节,保持可达。
import { join } from 'node:path'
import { wikiCopy, wikiLanguageLabel } from '../ai/wikiCopy.ts'
import type { WikiPlan, WikiPlanTopic } from './wikiPlanTypes.ts'
import { languageDir, WIKI_README, writeFileAtomic } from './wikiStore.ts'
import type { WikiLanguageStateV2 } from './wikiStoreV2.ts'
import { wikiIndexLink } from './wikiIndex.ts'

export interface WikiIndexV2Input {
  projectName: string
  language: string
  model: string
  generatedAt: string
  plan: WikiPlan
  languageState: WikiLanguageStateV2
  /** pageId 到相对语种目录的文件路径(与记账分配一致) */
  files: Map<string, string>
}

function formatTime(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso)
  return match ? `${match[1]} ${match[2]}` : iso
}

function pageLine(input: WikiIndexV2Input, pageId: string): string | null {
  const page = input.plan.pages.find((p) => p.id === pageId)
  if (!page) return null
  const record = input.languageState.pages[pageId]
  const file = input.files.get(pageId)
  const name = record?.name ?? page.title
  if (record?.status === 'done' && file !== undefined) {
    return `- [${name}](${wikiIndexLink(file)})`
  }
  return `- ${name}(待生成)`
}

function topicLines(input: WikiIndexV2Input, topic: WikiPlanTopic, depth: number): string[] {
  const lines: string[] = [`${'#'.repeat(Math.min(2 + depth, 6))} ${topic.title}`, '']
  if (topic.overviewPageId !== null) {
    const line = pageLine(input, topic.overviewPageId)
    if (line !== null) lines.push(line)
  }
  for (const pageId of topic.pageIds) {
    const line = pageLine(input, pageId)
    if (line !== null) lines.push(line)
  }
  if (lines.length > 2) lines.push('')
  for (const child of topic.children) lines.push(...topicLines(input, child, depth + 1))
  return lines
}

export function renderWikiIndexV2(input: WikiIndexV2Input): string {
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
  for (const pageId of input.plan.rootPageIds) {
    const line = pageLine(input, pageId)
    if (line !== null) lines.push(line)
  }
  if (input.plan.rootPageIds.length > 0) lines.push('')
  for (const topic of input.plan.topics) lines.push(...topicLines(input, topic, 0))
  const legacy = Object.values(input.languageState.legacy)
  if (legacy.length > 0) {
    lines.push('## 旧版页面', '')
    for (const record of legacy) lines.push(`- [${record.name}](${wikiIndexLink(record.file)})`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/** 目录页在整轮末尾重写;一页都没规划出来时不落空壳 */
export async function writeWikiIndexV2(projectDir: string, input: WikiIndexV2Input): Promise<void> {
  if (input.plan.pages.length === 0) return
  const file = join(languageDir(projectDir, input.language), WIKI_README)
  await writeFileAtomic(file, renderWikiIndexV2(input))
}
