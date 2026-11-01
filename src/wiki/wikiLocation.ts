// Wiki 存储位置校验:必须由用户手选、必须是仓库外的可写文件夹;
// 选中的文件夹已有别的内容且没有应用标记时,实际写入其下 CodeAtlasWiki,不跟用户文件混放。
import { constants, promises as fs } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { WIKI_MARKER_FILE, WIKI_SUBDIRECTORY } from '../shared/wikiTypes.ts'

export interface WikiLocationInput {
  /** 用户在对话框里选的文件夹 */
  chosen: string
  /** 当前与最近的项目根;Wiki 不得存进这里面 */
  projectRoots: readonly string[]
}

export type WikiLocationResult =
  { ok: true; location: string; usedSubdirectory: boolean } | { ok: false; reason: string }

const fail = (reason: string): WikiLocationResult => ({ ok: false, reason })

/** Windows 路径大小写不敏感;比较前统一折成小写 */
function foldCase(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** child 是否就是 parent 或在它下面(两者都按本机规则解析) */
export function isInsideRoot(child: string, parent: string): boolean {
  const rest = relative(foldCase(resolve(parent)), foldCase(resolve(child)))
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))
}

async function realpathOrResolve(path: string): Promise<string> {
  // 项目根万一已不存在也不阻断校验,退回字面路径比较
  return fs.realpath(path).catch(() => resolve(path))
}

async function checkChosen(chosen: string): Promise<string | WikiLocationResult> {
  if (!isAbsolute(chosen)) return fail('请选一个完整的文件夹路径')
  const real = await fs.realpath(chosen).catch((err: NodeJS.ErrnoException) => err)
  if (real instanceof Error) return fail('找不到这个文件夹,它可能已被移动或删除')
  const stat = await fs.stat(real).catch(() => null)
  if (!stat?.isDirectory()) return fail('这个路径不是文件夹,请选一个文件夹')
  return real
}

export async function resolveWikiLocation(input: WikiLocationInput): Promise<WikiLocationResult> {
  const chosen = input.chosen.trim()
  if (chosen === '') return fail('还没选存放位置,先选一个仓库外的文件夹')

  const checked = await checkChosen(chosen)
  if (typeof checked !== 'string') return checked

  const roots = await Promise.all(input.projectRoots.map(realpathOrResolve))
  if (roots.some((root) => isInsideRoot(checked, root))) {
    return fail('Wiki 不能存进被分析的仓库里,请选仓库外的文件夹')
  }

  const writable = await fs.access(checked, constants.W_OK).then(
    () => true,
    () => false
  )
  if (!writable) return fail('这个文件夹没有写入权限,换一个吧')

  const entries = await fs.readdir(checked).catch(() => null)
  if (entries === null) return fail('读不了这个文件夹,检查一下权限')
  const alreadyMarked = entries.includes(WIKI_MARKER_FILE)
  // 用户直接选中应用自己的子目录时不再套一层
  const isOwnSubdirectory = basename(checked).toLowerCase() === WIKI_SUBDIRECTORY.toLowerCase()
  if (entries.length === 0 || alreadyMarked || isOwnSubdirectory) {
    return { ok: true, location: checked, usedSubdirectory: false }
  }
  return { ok: true, location: join(checked, WIKI_SUBDIRECTORY), usedSubdirectory: true }
}

/** 选定位置就落标记:下次校验能认出这是应用自己的目录,根目录空了清理也能连根收 */
export async function ensureWikiRootMarker(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  const body = JSON.stringify({ schema: 1, createdAt: new Date().toISOString() }, null, 2)
  try {
    await fs.writeFile(join(root, WIKI_MARKER_FILE), body, { flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
}
