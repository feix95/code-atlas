// 规划登记:每页先有 planned 记录,部分完成时目录与进度都能如实表达;
// 已有记录只更新分配路径,旧路径由返回值带出,页面重新生成时写新删旧。
import type { WikiPlan } from './wikiPlanTypes.ts'
import type { WikiLanguageStateV2 } from './wikiStoreV2.ts'

export function registerPlanPages(
  plan: WikiPlan,
  files: Map<string, string>,
  languageState: WikiLanguageStateV2
): Map<string, string> {
  const previousFiles = new Map<string, string>()
  for (const page of plan.pages) {
    const existing = languageState.pages[page.id]
    const file = files.get(page.id)!
    if (existing) {
      previousFiles.set(page.id, existing.file)
      existing.file = file
      continue
    }
    languageState.pages[page.id] = {
      pageId: page.id,
      kind: page.kind,
      file,
      name: page.title,
      nameSource: 'program',
      status: 'planned',
      model: '',
      generatedAt: '',
      members: page.members.map((m) => ({ path: m.path, role: m.role, contentHash: null })),
      budgetNotes: []
    }
  }
  return previousFiles
}
