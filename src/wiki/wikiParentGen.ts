// 父页生成:程序出骨架(标题、下属页面表、关键文件),模型只写一段总览。
// 输入是下属页面的名称与摘要,不读代码;下属还没生成时用标题占位,指纹会随摘要到位而变,下轮自动重写。
import { promises as fs } from 'node:fs'
import type { WikiCompleter } from './wikiReadTypes.ts'
import type { WikiPlan, WikiPlanPage } from './wikiPlanTypes.ts'
import type { WikiPageProgressV2 } from './wikiJobV2.ts'
import {
  parentChildInputs,
  parentChildrenOf,
  parentFingerprint,
  type WikiParentChild
} from './wikiParentTree.ts'
import { pageFilePathV2, removePageFileV2, type WikiLanguageStateV2 } from './wikiStoreV2.ts'
import { writeFileAtomic } from './wikiStore.ts'

const INTRO_SYSTEM =
  '你是 Wiki 总览作者,负责给一组页面写总览。只依据给出的下属页面名称与摘要写作,不虚构不存在的功能。' +
  '用简洁中文写一段总览(120 到 260 字),说明这一组内容整体负责什么、下属各块大致怎么分工、读者应该先看哪一块。' +
  '不要输出标题、列表或代码围栏,只输出这一段文字。'

const CHILD_LINES_BUDGET = 5200

/** 相对链接按正斜杠纯字符串算:记账路径恒为正斜杠,不能走平台路径规则 */
function relLink(fromFile: string, toFile: string): string {
  const fromParts = fromFile.split('/').slice(0, -1)
  const toParts = toFile.split('/')
  let common = 0
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common += 1
  }
  const ups = Array.from({ length: fromParts.length - common }, () => '..')
  return [...ups, ...toParts.slice(common)].join('/')
}

function cleanIntro(raw: string): string {
  const text = raw
    .replace(/```[a-z]*\n?/gi, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .join(' ')
    .trim()
  return text.slice(0, 600)
}

function childLines(children: WikiParentChild[]): string {
  const lines: string[] = []
  let used = 0
  for (const child of children) {
    const line = `《${child.title}》:${child.summary === '' ? '(尚未生成说明)' : child.summary}`
    if (used + line.length > CHILD_LINES_BUDGET) {
      lines.push(`(其余 ${children.length - lines.length} 个下属页面略)`)
      break
    }
    used += line.length
    lines.push(line)
  }
  return lines.join('\n')
}

export async function buildParentMarkdown(
  page: WikiPlanPage,
  parentFile: string,
  children: WikiParentChild[],
  complete: WikiCompleter
): Promise<string> {
  const user = [
    `主题:${page.title}`,
    page.basis.length > 0 ? `切分依据:${page.basis.join('、')}` : '',
    children.length > 0 ? `下属页面:\n${childLines(children)}` : '下属页面:暂无已规划的下属页面'
  ]
    .filter((line) => line !== '')
    .join('\n')
  const intro = cleanIntro(await complete(INTRO_SYSTEM, user, 700))
  if (intro === '') throw new Error('模型没返回内容')

  const parts = [`# ${page.title}`, '', intro]
  if (children.length > 0) {
    parts.push('', '## 下属页面', '', '| 页面 | 说明 |', '| --- | --- |')
    for (const child of children) {
      const label =
        child.file !== ''
          ? `[《${child.title}》](${relLink(parentFile, child.file)})`
          : `《${child.title}》`
      parts.push(`| ${label} | ${child.summary === '' ? '尚未生成' : child.summary} |`)
    }
  }
  const keyFiles = page.members.filter((m) => m.role === 'primary').slice(0, 8)
  if (keyFiles.length > 0) {
    parts.push('', '## 关键文件', '')
    for (const member of keyFiles) parts.push(`- \`${member.path}\``)
  }
  return parts.join('\n') + '\n'
}

export interface ParentPagesContext {
  projectDir: string
  language: string
  model: string
  force?: boolean
  complete: WikiCompleter
  now: () => string
  isActive: () => boolean
  emit: (page: WikiPageProgressV2) => void
  persist: () => Promise<void>
}

function firstIntroLine(markdown: string): string | undefined {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('#') && !line.startsWith('>'))
}

export async function runParentPages(
  args: {
    plan: WikiPlan
    pages: WikiPlanPage[]
    languageState: WikiLanguageStateV2
    files: Map<string, string>
    previousFiles: Map<string, string>
  },
  ctx: ParentPagesContext
): Promise<{ done: number; skipped: number; failed: number; cancelled: boolean }> {
  let done = 0
  let skipped = 0
  let failed = 0
  let cancelled = false
  const childrenOf = parentChildrenOf(args.plan)
  for (const page of args.pages) {
    const record = args.languageState.pages[page.id]!
    const progress = { pageId: page.id, kind: page.kind, name: record.name }
    if (!ctx.isActive()) {
      cancelled = true
      ctx.emit({ ...progress, status: 'cancelled' })
      break
    }
    const children = parentChildInputs(args.plan, args.languageState, childrenOf.get(page.id) ?? [])
    const fingerprint = parentFingerprint(children)
    const exists = await fs.access(pageFilePathV2(ctx.projectDir, ctx.language, record)).then(
      () => true,
      () => false
    )
    if (
      ctx.force !== true &&
      record.status === 'done' &&
      record.inputHash === fingerprint &&
      exists
    ) {
      skipped += 1
      ctx.emit({ ...progress, status: 'skipped', file: record.file })
      continue
    }
    ctx.emit({ ...progress, status: 'running' })
    try {
      const markdown = await buildParentMarkdown(
        page,
        args.files.get(page.id)!,
        children,
        ctx.complete
      )
      if (!ctx.isActive()) {
        cancelled = true
        ctx.emit({ ...progress, status: 'cancelled' })
        break
      }
      const previousFile = args.previousFiles.get(page.id) ?? record.file
      record.file = args.files.get(page.id)!
      await writeFileAtomic(pageFilePathV2(ctx.projectDir, ctx.language, record), markdown)
      if (previousFile !== record.file) {
        await removePageFileV2(ctx.projectDir, ctx.language, previousFile)
      }
      record.status = 'done'
      record.model = ctx.model
      record.generatedAt = ctx.now()
      record.inputHash = fingerprint
      record.keyFiles = page.members
        .filter((m) => m.role === 'primary')
        .slice(0, 5)
        .map((m) => m.path)
      const introLine = firstIntroLine(markdown)
      if (introLine !== undefined) {
        record.summary = introLine.slice(0, 120)
        record.excerpt = introLine.slice(0, 400)
      }
      await ctx.persist()
      done += 1
      ctx.emit({ ...progress, status: 'done', file: record.file })
    } catch (err) {
      if (!ctx.isActive()) {
        cancelled = true
        ctx.emit({ ...progress, status: 'cancelled' })
        break
      }
      record.status = 'failed'
      record.generatedAt = ctx.now()
      await ctx.persist()
      failed += 1
      ctx.emit({
        ...progress,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Wiki 生成失败'
      })
    }
  }
  return { done, skipped, failed, cancelled }
}
