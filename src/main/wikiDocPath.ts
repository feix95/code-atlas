// 打开 Wiki 文档前的路径校验:只认语种目录下记账形状的相对路径,
// realpath 之后必须仍在 Wiki 根内;渲染层传来的其它路径一律拒绝。
import { promises as fs } from 'node:fs'
import { translateLang } from '../shared/translateLangs.ts'
import { isInsideRoot } from '../wiki/wikiLocation.ts'
import { isSafePageFile, pageFilePath } from '../wiki/wikiStore.ts'
import { resolveProjectDir } from '../wiki/wikiProjectDir.ts'
import { pageFilePathV2 } from '../wiki/wikiStoreV2.ts'
import { isSafePageFileV2 } from '../wiki/wikiPlanStore.ts'
import { parseProjectRoot } from './wikiRequest.ts'

export async function resolveWikiDocPath(
  raw: unknown,
  location: string | null
): Promise<{ path: string } | { error: string }> {
  if (typeof raw !== 'object' || raw === null) return { error: '打开路径不完整' }
  const record = raw as Record<string, unknown>
  const projectRoot = parseProjectRoot(record.projectRoot)
  const file = typeof record.file === 'string' ? record.file : ''
  const language = typeof record.language === 'string' ? record.language : ''
  if (projectRoot === null || file === '' || translateLang(language) === null) {
    return { error: '打开路径不完整' }
  }
  const v1Shape = isSafePageFile(file)
  if (!v1Shape && !isSafePageFileV2(file)) return { error: '这份文档不在生成目录里' }
  if (location === null) return { error: '还没选 Wiki 存放位置' }
  const projectDir = await resolveProjectDir(location, projectRoot)
  const abs = await fs
    .realpath(
      v1Shape
        ? pageFilePath(projectDir, language, { file })
        : pageFilePathV2(projectDir, language, { file })
    )
    .catch(() => null)
  const rootReal = await fs.realpath(location).catch(() => null)
  if (abs === null || rootReal === null || !isInsideRoot(abs, rootReal)) {
    return { error: '这份文档已经不在 Wiki 目录里了' }
  }
  return { path: abs }
}
