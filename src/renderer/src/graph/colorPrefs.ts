// 改色存档的通用形状:项目根路径 → (条目键 → #rrggbb)。模块色与标签色共用清洗与写入规则。
const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

/** 当前项目生效的改色:条目键 → #rrggbb */
export type ColorOverrides = ReadonlyMap<string, string>

/** 每个项目一份:项目根路径 → (条目键 → #rrggbb) */
export type ColorPrefs = Record<string, Record<string, string>>

/** 一个项目最多记住的改色条数;超出时丢掉最早写入的 */
export const MAX_OVERRIDES_PER_ROOT = 200

/** 读存档时清洗:只留字符串键 + 合法 #rrggbb 值,其余静默丢弃 */
export function sanitizeColorPrefs(raw: unknown): ColorPrefs {
  const out: ColorPrefs = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [root, entries] of Object.entries(raw)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
    const kept = Object.entries(entries).filter((e): e is [string, string] => isHexColor(e[1]))
    if (kept.length > 0)
      out[root] = Object.fromEntries(
        kept.slice(-MAX_OVERRIDES_PER_ROOT).map(([id, c]) => [id, c.toLowerCase()])
      )
  }
  return out
}

/** 改一个条目的颜色;color 为 null = 恢复默认 */
export function setColorIn(
  prefs: ColorPrefs,
  root: string,
  key: string,
  color: string | null
): ColorPrefs {
  const current = { ...(prefs[root] ?? {}) }
  delete current[key]
  if (color !== null && isHexColor(color)) current[key] = color.toLowerCase()
  const entries = Object.entries(current).slice(-MAX_OVERRIDES_PER_ROOT)
  const next = { ...prefs }
  if (entries.length === 0) delete next[root]
  else next[root] = Object.fromEntries(entries)
  return next
}
