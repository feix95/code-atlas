/** 这份预览签能不能翻译:与 canReadingMode(排版显示)并列,禁止合并。
 *
 * md 系继续可翻;另收给人读的说明书(.txt / .rst / .adoc / .asciidoc)。
 * 程序文件碰巧叫 .txt 的挡掉(包装清单、编译脚本、爬虫规则)。
 */
import { fileExtOf } from './fileRename.ts'

export type TranslateFamily = 'markdown' | 'plaintext' | 'markup'

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdx'])
const PLAIN_EXTS = new Set(['.txt'])
const MARKUP_EXTS = new Set(['.rst', '.adoc', '.asciidoc'])
const BLOCKED_TXT_EXACT = new Set([
  'requirements.txt',
  'constraints.txt',
  'cmakelists.txt',
  'robots.txt'
])

function baseName(relPath: string): string {
  const sep = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'))
  return relPath.slice(sep + 1)
}

/** 包装清单的常见变体:requirements-dev.txt、dev-requirements.txt,constraints 同款 */
function isBlockedTxt(fileName: string): boolean {
  const n = fileName.toLowerCase()
  if (BLOCKED_TXT_EXACT.has(n)) return true
  if (n.startsWith('requirements-') && n.endsWith('.txt')) return true
  if (n.startsWith('constraints-') && n.endsWith('.txt')) return true
  if (n.endsWith('-requirements.txt')) return true
  if (n.endsWith('-constraints.txt')) return true
  return false
}

/** 按路径判定翻译族;null = 菜单不摆「翻译成…」 */
export function translateFamilyOf(relPath: string): TranslateFamily | null {
  const name = baseName(relPath)
  const ext = fileExtOf(name)
  if (MARKDOWN_EXTS.has(ext)) return 'markdown'
  if (MARKUP_EXTS.has(ext)) return 'markup'
  if (PLAIN_EXTS.has(ext) && !isBlockedTxt(name)) return 'plaintext'
  return null
}

export function canTranslate(relPath: string): boolean {
  return translateFamilyOf(relPath) !== null
}

/** 对照稿走分段纯文本、禁止 MiniMD(txt/rst/adoc/asciidoc) */
export function usesPlainTranslateView(relPath: string): boolean {
  const family = translateFamilyOf(relPath)
  return family === 'plaintext' || family === 'markup'
}
