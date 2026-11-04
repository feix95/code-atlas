// 项目目录解析:不重名用项目名;重名且记账属于别的项目时加短编号。
// 记账按任意版本读:第二版 state 与旧版 state 都按 projectRoot 匹配回原目录,
// 否则第一次写出新版记账后就会误判目录被占用、另开新目录重复生成。
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { isEmptyDir, isSamePath, sanitizeFileName, shortProjectCode } from './wikiStore.ts'
import { readWikiStateAny } from './wikiStoreV2.ts'
import { isWallOwner } from './wikiWallNotesStore.ts'

export async function resolveProjectDir(wikiRoot: string, projectRoot: string): Promise<string> {
  const base = sanitizeFileName(basename(projectRoot)) || 'project'
  const short = `${base}-${shortProjectCode(projectRoot)}`
  const names = [base, short]
  for (let i = 2; i <= 20; i++) names.push(`${short}-${i}`)
  for (const name of names) {
    const dir = join(wikiRoot, name)
    const stat = await fs.stat(dir).catch(() => null)
    if (stat === null) return dir
    if (!stat.isDirectory()) continue
    const state = await readWikiStateAny(dir)
    if (state.status === 'ok' && isSamePath(state.state.projectRoot, projectRoot)) return dir
    if (state.status === 'missing' && (await isEmptyDir(dir))) return dir
    // 还没生成过 Wiki、只先贴了线索桌便签的目录,靠便签存档里的项目路径认回来
    if (state.status === 'missing' && (await isWallOwner(dir, projectRoot))) return dir
  }
  return join(wikiRoot, `${short}-${Date.now().toString(36)}`)
}
