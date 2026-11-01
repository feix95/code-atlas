// 模块显示名:当前语种有 Wiki 就用 AI 名称,没生成的回退程序名。
// 两条 AI 名称撞车时各自缀上程序名,画布与侧栏仍能分清是谁。
import type { ModuleInfo } from '@shared/types'
import { moduleDisplayName } from './moduleOverlay.ts'

export type ModuleNames = ReadonlyMap<string, string>

export function moduleNamesOf(
  modules: readonly ModuleInfo[],
  aiNameOf: (moduleId: string) => string | null
): ModuleNames {
  const rows = modules.map((module) => ({
    id: module.id,
    program: moduleDisplayName(module),
    ai: aiNameOf(module.id) || null
  }))
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.ai !== null) counts.set(row.ai, (counts.get(row.ai) ?? 0) + 1)
  }
  return new Map(
    rows.map((row) => {
      const name =
        row.ai === null
          ? row.program
          : counts.get(row.ai) === 1
            ? row.ai
            : `${row.ai} · ${row.program}`
      return [row.id, name]
    })
  )
}
