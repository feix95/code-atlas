// ── 第八十一锤:最近打开的项目 ──
// 首页给一排「最近打开」:项目名 + 路径 + 上次时间,点一下直接重新画图,小 ✕ 能删。
// 存 localStorage(atlas.recent-projects)—— 界面的事每台机器自己一套,不进 AI 配置也不进仓库。
// 老账本是垃圾怎么办:parseRecentProjects 只认干净的,垃圾整条扔、超长掐头,绝不炸首页。

export const RECENTS_KEY = 'atlas.recent-projects'
/** 只记最近 8 个:再多就是抽屉不是门厅了 */
export const RECENTS_MAX = 8

export interface RecentProject {
  /** 完整路径(打开就靠它) */
  p: string
  /** 展示名:路径最后一段;盘根就照实写 C:\ */
  n: string
  /** 上次打开的时刻(ms) */
  t: number
}

/** 原文 → 干净的最近列表(纯函数,自测覆盖);没记过/垃圾一律回 [] */
export function parseRecentProjects(raw: unknown): RecentProject[] {
  if (!Array.isArray(raw)) return []
  const out: RecentProject[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const r = item as Record<string, unknown>
    if (typeof r['p'] !== 'string' || r['p'].trim() === '') continue
    if (typeof r['n'] !== 'string' || r['n'].trim() === '') continue
    if (typeof r['t'] !== 'number' || !Number.isFinite(r['t']) || r['t'] <= 0) continue
    out.push({ p: r['p'], n: r['n'], t: r['t'] })
  }
  return out.slice(0, RECENTS_MAX)
}

/** 某项目刚打开过:同名路径(Windows 路径不分大小写)挤掉旧账顶到最前,超长从队尾滚出去
 *  (纯函数,自测覆盖) */
export function nextRecentProjects(raw: unknown, path: string, name: string, ts: number): RecentProject[] {
  const rest = parseRecentProjects(raw).filter((r) => r.p.toLowerCase() !== path.toLowerCase())
  return [{ p: path, n: name, t: ts }, ...rest].slice(0, RECENTS_MAX)
}

/** 手动删一条(纯函数,自测覆盖);删不存在的就当删过,列表原样 */
export function removeRecentProject(raw: unknown, path: string): RecentProject[] {
  return parseRecentProjects(raw).filter((r) => r.p.toLowerCase() !== path.toLowerCase())
}

/** 路径末段当展示名;盘根(C:\)末段是空的,照实写回整个路径 */
export function recentNameFor(path: string): string {
  const tail = path.split(/[\\/]/).pop() ?? ''
  return tail === '' ? path : tail
}

function readRaw(): unknown {
  try {
    const text = localStorage.getItem(RECENTS_KEY)
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

export function readRecentProjects(): RecentProject[] {
  return parseRecentProjects(readRaw())
}

export function writeRecentProjects(list: RecentProject[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list))
  } catch {
    // 写不进去就算了:最近列表是锦上添花,不该惊动任何人
  }
}

/** 在 App 里当一声「刚打开过」:读 → 记 → 写,三步合成一步给调用方省心 */
export function rememberRecentProject(path: string): RecentProject[] {
  const list = nextRecentProjects(readRaw(), path, recentNameFor(path), Date.now())
  writeRecentProjects(list)
  return list
}

/** 把某条从存档里抠掉(点 ✕ 用),返回新列表 */
export function forgetRecentProject(path: string): RecentProject[] {
  const list = removeRecentProject(readRaw(), path)
  writeRecentProjects(list)
  return list
}

/** 上次时间的展示话术(纯函数,自测覆盖):今天报时刻,昨天说昨天,再往前报日期 */
export function formatRecentTime(ts: number, now: number = Date.now()): string {
  const d = new Date(ts)
  const startOfDay = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86_400_000)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (days <= 0) return `今天 ${hm}`
  if (days === 1) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
