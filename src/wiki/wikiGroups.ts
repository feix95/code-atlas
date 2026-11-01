// 散件分组(纯函数):没被任何模块收进去的文件按路径与后缀分成四组,每组一篇 Wiki。
// 只影响面板与 Wiki 的归属,不改图谱结构;分组顺序固定,同一输入永远同一结果。
import { basename, extname } from 'node:path'

export type ScatterGroupKind = 'root-config' | 'git-hooks' | 'docs-assets' | 'other'

export interface ScatterGroup {
  /** 稳定 id,带 g: 前缀,与文件路径、模块 id 都不冲突 */
  id: string
  kind: ScatterGroupKind
  /** 程序生成的组名;P3 起可由 AI 另起名称 */
  name: string
  files: string[]
}

export const SCATTER_GROUP_NAMES: Record<ScatterGroupKind, string> = {
  'root-config': '项目根配置',
  'git-hooks': 'Git 钩子',
  'docs-assets': '文档与资源',
  other: '其他目录散件'
}

const GROUP_ORDER: readonly ScatterGroupKind[] = [
  'root-config',
  'git-hooks',
  'docs-assets',
  'other'
]

const GIT_HOOK_DIRS = ['.git/hooks/', '.husky/', '.githooks/']

const DOC_ASSET_DIRS = ['docs/', 'doc/', 'assets/', 'images/', 'media/']

const DOC_ASSET_EXT = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.adoc',
  '.pdf',
  '.doc',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.avif',
  '.ico',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
  '.mkv',
  '.csv'
])

const DOC_BASENAMES = new Set([
  'license',
  'licence',
  'copying',
  'notice',
  'readme',
  'changelog',
  'contributing'
])

function classifyScattered(file: string): ScatterGroupKind {
  const lower = file.toLowerCase()
  if (GIT_HOOK_DIRS.some((dir) => lower.startsWith(dir))) return 'git-hooks'
  if (DOC_ASSET_DIRS.some((dir) => lower.startsWith(dir))) return 'docs-assets'
  if (DOC_ASSET_EXT.has(extname(lower))) return 'docs-assets'
  if (DOC_BASENAMES.has(basename(lower, extname(lower)))) return 'docs-assets'
  if (!file.includes('/')) return 'root-config'
  return 'other'
}

export function groupScatteredFiles(files: readonly string[]): ScatterGroup[] {
  const buckets = new Map<ScatterGroupKind, Set<string>>()
  for (const file of files) {
    if (file === '') continue
    const kind = classifyScattered(file)
    const bucket = buckets.get(kind) ?? new Set<string>()
    bucket.add(file)
    buckets.set(kind, bucket)
  }
  return GROUP_ORDER.flatMap((kind): ScatterGroup[] => {
    const bucket = buckets.get(kind)
    if (bucket === undefined || bucket.size === 0) return []
    return [
      {
        id: `g:${kind}`,
        kind,
        name: SCATTER_GROUP_NAMES[kind],
        files: [...bucket].sort()
      }
    ]
  })
}
