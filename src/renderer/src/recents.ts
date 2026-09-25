// ── 第八十一锤:最近打开的项目 ──
// 首页给一排「最近打开」:项目名 + 路径 + 上次时间,点一下直接重新画图,小 ✕ 能删。
// 存 localStorage(atlas.recent-projects)—— 界面的事每台机器自己一套,不进 AI 配置也不进仓库。
// 老账本是垃圾怎么办:parseRecentProjects 只认干净的,垃圾整条扔、超长掐头,绝不炸首页。

import { readPref, writePref } from '../../shared/localPrefs.ts'

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
  /** 钉住时刻(ms,UI v3 §7.1):有值 = 常驻 pin 区,不占历史名额、不被时间淘汰 */
  pin?: number
}

/** 账本封顶:未 pin 条目只留最近 RECENTS_MAX 条;pin 条目不淘汰(仅手动 unpin 回流)。
 *  垃圾防御另上一道总闸:整本账最多 40 条,再多掐尾 */
const LEDGER_HARD_CAP = 40
function capLedger(list: RecentProject[]): RecentProject[] {
  const out: RecentProject[] = []
  let plain = 0
  for (const r of list) {
    if (r.pin === undefined) {
      if (plain >= RECENTS_MAX) continue
      plain += 1
    }
    out.push(r)
    if (out.length >= LEDGER_HARD_CAP) break
  }
  return out
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
    const pin = r['pin']
    out.push(
      typeof pin === 'number' && Number.isFinite(pin) && pin > 0
        ? { p: r['p'], n: r['n'], t: r['t'], pin }
        : { p: r['p'], n: r['n'], t: r['t'] }
    )
  }
  return capLedger(out)
}

/** 某项目刚打开过:同名路径(Windows 路径不分大小写)挤掉旧账顶到最前,超长从队尾滚出去。
 *  pin 跟着路径走:重新打开不丢钉(纯函数,自测覆盖) */
export function nextRecentProjects(
  raw: unknown,
  path: string,
  name: string,
  ts: number
): RecentProject[] {
  const prev = parseRecentProjects(raw)
  const kept = prev.find((r) => r.p.toLowerCase() === path.toLowerCase())
  const rest = prev.filter((r) => r.p.toLowerCase() !== path.toLowerCase())
  const head: RecentProject =
    kept?.pin !== undefined
      ? { p: path, n: name, t: ts, pin: kept.pin }
      : { p: path, n: name, t: ts }
  return capLedger([head, ...rest])
}

/** pin/unpin 切换(纯函数):pin 记当下时刻(菜单按 pin 时间倒序);unpin 摘掉字段回流历史,
 *  在历史流里的位置仍看最近打开时间 */
export function nextPinToggle(raw: unknown, path: string, ts: number): RecentProject[] {
  const key = path.toLowerCase()
  const next = parseRecentProjects(raw).map((r): RecentProject => {
    if (r.p.toLowerCase() !== key) return r
    if (r.pin === undefined) return { ...r, pin: ts }
    return { p: r.p, n: r.n, t: r.t }
  })
  return capLedger(next)
}

/** 工作区菜单的分区视图(纯函数,§7.1):pin 区按 pin 时刻倒序置顶,
 *  历史区 = 最近未 pin 的前 5 条;两区天然去重(一条账只在一区) */
export function menuWorkspaceRows(list: RecentProject[]): {
  pinned: RecentProject[]
  history: RecentProject[]
} {
  const pinned = list.filter((r) => r.pin !== undefined).sort((a, b) => (b.pin ?? 0) - (a.pin ?? 0))
  const history = list.filter((r) => r.pin === undefined).slice(0, 5)
  return { pinned, history }
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

export function readRecentProjects(): RecentProject[] {
  return parseRecentProjects(readPref<unknown>(RECENTS_KEY, null))
}

export function writeRecentProjects(list: RecentProject[]): void {
  writePref(RECENTS_KEY, list)
}

/** 在 App 里当一声「刚打开过」:读 → 记 → 写,三步合成一步给调用方省心 */
export function rememberRecentProject(path: string): RecentProject[] {
  const list = nextRecentProjects(
    readPref<unknown>(RECENTS_KEY, null),
    path,
    recentNameFor(path),
    Date.now()
  )
  writeRecentProjects(list)
  return list
}

/** 把某条从存档里抠掉(点 ✕ 用),返回新列表 */
export function forgetRecentProject(path: string): RecentProject[] {
  const list = removeRecentProject(readPref<unknown>(RECENTS_KEY, null), path)
  writeRecentProjects(list)
  return list
}

/** pin/unpin 切换并写回(工作区菜单行首 pin 钮),返回新列表 */
export function toggleRecentPin(path: string): RecentProject[] {
  const list = nextPinToggle(readPref<unknown>(RECENTS_KEY, null), path, Date.now())
  writeRecentProjects(list)
  return list
}

/** 上次时间的展示话术(纯函数,自测覆盖):今天报时刻,昨天说昨天,再往前报日期 */
export function formatRecentTime(ts: number, now: number = Date.now()): string {
  const d = new Date(ts)
  const startOfDay = (x: Date): number =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86_400_000)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (days <= 0) return `今天 ${hm}`
  if (days === 1) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
