// 方案文件(第 15 节)与方案库(第 5.8 节)的纯函数层:序列化、解析迁移、清单、id 与快照命名。
// M1 以文件夹形式存放;M2 启用 zip 时内部结构不变。
import { isCustomIconName } from './customIcon.ts'
import { defaultDeviceId, isDeviceId } from './devices.ts'
import { defaultDoc, defaultTokens } from './template.ts'
import type { IconSlot, PlacedPart, SchemeManifest, TokenDef, UiFrameDoc } from './types.ts'

export const SCHEME_FORMAT_VERSION = 1

/** 方案文件夹名/方案 id 的合法字符:中英文、数字、点、横线、下划线 */
export const SCHEME_ID_RE = /^[\w一-龥.-]{1,64}$/

/** 快照文件名:YYYYMMDD-HHmmss.json */
export const SNAPSHOT_RE = /^\d{8}-\d{6}\.json$/

/** 方案名 → 文件夹名/id;清空字符或只剩符号(如「..」)时兜底时间戳 */
export function schemeIdFromName(name: string, stamp: string): string {
  const slug = name
    .trim()
    .replace(/[^\w一-龥.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug && /[\w一-龥]/.test(slug) ? slug : `方案-${stamp}`
}

/** 快照文件名(本地时间) */
export function snapshotStamp(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

/** design.json 正文:UiFrameDoc 序列化(2 空格缩进,人可读) */
export function serializeDoc(doc: UiFrameDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

const KNOWN_KINDS = new Set([
  'color',
  'dimension',
  'em',
  'number',
  'fontWeight',
  'fontFamily',
  'shadow',
  'ref'
])

function isTokenValue(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const v = raw as Record<string, unknown>
  return typeof v['kind'] === 'string' && KNOWN_KINDS.has(v['kind'])
}

/** customIcons 清洗:名要合法、值要是 <svg> 文本(恶意形态在这一层直接丢) */
function cleanCustomIcons(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isCustomIconName(k) && typeof v === 'string' && /^<svg[\s>]/.test(v.trim())) {
      out[k] = v
    }
  }
  return out
}

/** 解析 design.json:版本校验 + 逐条清洗,缺字段补默认模板(老方案在新版打开不掉变量) */
export function parseDoc(text: string): UiFrameDoc {
  const raw = JSON.parse(text) as Record<string, unknown>
  if (raw['schemaVersion'] !== 1)
    throw new Error(`方案格式版本不支持:${String(raw['schemaVersion'])}`)
  const tokens = defaultTokens()
  const saved = raw['tokens']
  if (typeof saved !== 'object' || saved === null) throw new Error('方案缺 tokens 表')
  for (const [name, def] of Object.entries(saved)) {
    const d = def as Partial<TokenDef> | null
    if (
      d &&
      Array.isArray(d.path) &&
      typeof d.label === 'string' &&
      typeof d.tier === 'string' &&
      isTokenValue(d.value)
    ) {
      tokens[name] = d as TokenDef
    }
  }
  const icons = raw['icons']
  const cleanIcons: Record<string, string> = {}
  if (typeof icons === 'object' && icons !== null) {
    for (const [slot, name] of Object.entries(icons)) {
      if (typeof name === 'string') cleanIcons[slot] = name
    }
  }
  const platform = raw['platform'] === 'phone' ? 'phone' : 'desktop'
  const rootFontPx = typeof raw['rootFontPx'] === 'number' ? raw['rootFontPx'] : 16
  // 底板摆放(M3-a):逐条清洗,坏条目丢掉不挡打开
  const placed: PlacedPart[] = []
  if (Array.isArray(raw['placed'])) {
    for (const p of raw['placed'] as Array<Record<string, unknown>>) {
      if (
        p &&
        typeof p.id === 'string' &&
        typeof p.recipe === 'string' &&
        typeof p.x === 'number' &&
        typeof p.y === 'number' &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y)
      ) {
        placed.push({ id: p.id, recipe: p.recipe, x: p.x, y: p.y })
      }
    }
  }
  return {
    schemaVersion: 1,
    name: typeof raw['name'] === 'string' && raw['name'] ? raw['name'] : '未命名方案',
    platform,
    device: isDeviceId(platform, raw['device']) ? raw['device'] : defaultDeviceId(platform),
    template: typeof raw['template'] === 'string' ? raw['template'] : 'blank',
    rootFontPx,
    tokens,
    // 旧文档缺槽位时补默认图标(新增 IconSlot 后旧方案也能渲染)
    icons: { ...defaultDoc().icons, ...cleanIcons } as Record<IconSlot, string>,
    // 自定义图标(M3-e):只收名字合法、文本是 <svg> 的条目;坏条目丢掉
    customIcons: cleanCustomIcons(raw['customIcons']),
    placed,
    ...(raw['a11yEnhanced'] === true ? { a11yEnhanced: true } : {}),
    ...(typeof raw['targetStack'] === 'string' && raw['targetStack']
      ? { targetStack: raw['targetStack'] }
      : {})
  }
}

/** 生成 manifest(第 15 节):版本号 + 平台 + 风格 + 起止时间 + 应用版本 */
export function manifestFor(
  doc: UiFrameDoc,
  opts: { id: string; style: string; createdAt: string; appVersion: string }
): SchemeManifest {
  return {
    formatVersion: SCHEME_FORMAT_VERSION,
    id: opts.id,
    name: doc.name,
    platform: doc.platform,
    style: opts.style,
    template: doc.template,
    createdAt: opts.createdAt,
    modifiedAt: new Date().toISOString(),
    appVersion: opts.appVersion
  }
}
