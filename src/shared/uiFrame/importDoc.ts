// 导入(§14):方案文件夹 / DTCG token JSON / CSS 变量,全部解析成 UiFrameDoc。
// 三条源共用一个口径:只改写「同名已存在」变量的 value——名字对不上的键记入 skipped 名单,
// 不往变量表里生造新变量(变量表是固定结构,导入不是扩表)。
import { DTCG_EXT } from './designJson.ts'
import { defaultDeviceId, isDeviceId } from './devices.ts'
import { parseDoc } from './scheme.ts'
import { defaultDoc } from './template.ts'
import type { IconSlot, TokenValue, UiFrameDoc, UiPlatform } from './types.ts'

export type ImportSource = 'scheme' | 'dtcg' | 'css'

export interface ImportResult {
  doc: UiFrameDoc
  /** 成功套上的变量数 */
  applied: number
  /** 没匹配上的来源键名(最多记前 20 个) */
  skipped: string[]
  sourceLabel: string
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

const SKIPPED_LIMIT = 20

class Collector {
  applied = 0
  skipped: string[] = []
  miss(key: string): void {
    if (this.skipped.length < SKIPPED_LIMIT) this.skipped.push(key)
  }
}

// ── 值换算:文本/DTCG 对象 → TokenValue ──

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

/** DTCG 颜色对象 → #rrggbb;带 alpha 时回 rgba() 原文 */
function colorObjToCss(v: Record<string, Json>): string | null {
  const hex = v['hex']
  if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase()
  const comp = v['components']
  if (Array.isArray(comp) && comp.length >= 3) {
    const [r, g, b] = comp.map((c) => clampByte(Number(c) * 255))
    const alpha = typeof v['alpha'] === 'number' ? v['alpha'] : 1
    return alpha >= 1
      ? `#${[r, g, b]
          .map((c) => c.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()}`
      : `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return null
}

/** 颜色文本(#hex / rgb() / rgba() / hsl() / hsla())→ TokenValue;两套都给同一值 */
function colorTextValue(text: string): TokenValue | null {
  const t = text.trim()
  if (!/^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(t)) return null
  // hex 统一成内部口径:大写、3 位展开成 6 位
  const short = /^#([0-9a-fA-F]{3})$/.exec(t)
  const norm = short
    ? `#${short[1]!
        .split('')
        .map((c) => c + c)
        .join('')
        .toUpperCase()}`
    : t.startsWith('#')
      ? t.toUpperCase()
      : t
  return { kind: 'color', light: norm, dark: norm }
}

/** {value, unit} 或 '16px'/'0.5rem' → 逻辑像素;rootPx = 该文件的根字号 */
function dimToPx(v: Json, rootPx: number): number | null {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const value = Number((v as Record<string, Json>)['value'])
    const unit = (v as Record<string, Json>)['unit']
    if (!Number.isFinite(value)) return null
    if (unit === 'rem') return Math.round(value * rootPx * 100) / 100
    if (unit === 'px' || unit === undefined) return value
    return null
  }
  if (typeof v === 'string') {
    const m = /^(-?\d+(?:\.\d+)?)(px|rem|em)$/.exec(v.trim())
    if (!m) return null
    const n = Number(m[1])
    return m[2] === 'px' ? n : Math.round(n * rootPx * 100) / 100
  }
  return null
}

/** rgba()/hex → rgba() 原文(阴影色用) */
function colorObjToRgba(v: Json): string | null {
  if (typeof v === 'string') return colorTextValue(v) ? v : null
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const css = colorObjToCss(v as Record<string, Json>)
    return css
  }
  return null
}

/** DTCG {a.b} 引用 → 变量名 */
function refName(text: string): string | null {
  const m = /^\{([^{}]+)\}$/.exec(text.trim())
  return m ? m[1]!.trim().replace(/\./g, '-') : null
}

/** 按既有变量的 kind 把字面值猜成对应 TokenValue;猜不出回 null */
function inferValue(text: string, existing: TokenValue, rootPx: number): TokenValue | null {
  const t = text.trim().replace(/;$/, '')
  const ref = refName(t) ?? /^var\(--([\w-]+)\)$/.exec(t)?.[1] ?? null
  if (ref) return { kind: 'ref', ref }
  switch (existing.kind) {
    case 'color':
      return colorTextValue(t)
    case 'dimension': {
      const px = dimToPx(t, rootPx)
      return px === null ? null : { kind: 'dimension', px }
    }
    case 'em': {
      const m = /^(-?\d+(?:\.\d+)?)em$/.exec(t)
      return m ? { kind: 'em', value: Number(m[1]) } : null
    }
    case 'number':
    case 'fontWeight': {
      const n = Number(t)
      if (!Number.isFinite(n)) return null
      return existing.kind === 'fontWeight'
        ? { kind: 'fontWeight', value: n }
        : { kind: 'number', value: n }
    }
    case 'fontFamily': {
      const families = t
        .split(',')
        .map((f) => f.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
      return families.length ? { kind: 'fontFamily', families } : null
    }
    case 'shadow':
      return parseShadow(t, rootPx)
    case 'ref': {
      // ref 变量给个独立值:按「指向变量的 kind」猜
      const px = dimToPx(t, rootPx)
      if (px !== null) return { kind: 'dimension', px }
      return colorTextValue(t)
    }
  }
}

const SHADOW_RE =
  /^(-?\d+(?:\.\d+)?)(px|rem|em)?\s+(-?\d+(?:\.\d+)?)(px|rem|em)?\s+(-?\d+(?:\.\d+)?)(px|rem|em)?(?:\s+(-?\d+(?:\.\d+)?)(px|rem|em)?)?\s+(.+)$/

function toPx(n: string, unit: string | undefined, rootPx: number): number {
  const v = Number(n)
  return unit === 'px' || !unit ? v : Math.round(v * rootPx * 100) / 100
}

function parseShadow(text: string, rootPx: number): TokenValue | null {
  const m = SHADOW_RE.exec(text.replace(/^inset\s+/, '').trim())
  if (!m) return null
  const color = colorObjToRgba(m[9]!)
  if (!color) return null
  return {
    kind: 'shadow',
    x: toPx(m[1]!, m[2], rootPx),
    y: toPx(m[3]!, m[4], rootPx),
    blur: toPx(m[5]!, m[6], rootPx),
    spread: m[7] ? toPx(m[7], m[8], rootPx) : 0,
    light: color,
    dark: color
  }
}

/** 把值写进 doc.tokens[name] 的 value;不存在就记 skipped */
function applyToken(doc: UiFrameDoc, c: Collector, name: string, value: TokenValue | null): void {
  if (!doc.tokens[name]) {
    c.miss(name)
    return
  }
  if (value === null) {
    c.miss(`${name}(值没认出)`)
    return
  }
  doc.tokens[name] = { ...doc.tokens[name], value }
  c.applied++
}

// ── 源 1:方案文件夹(manifest.json + design.json;design 也可以是导出的 DTCG)──

export function importSchemeFiles(
  manifestText: string | null,
  designText: string,
  fallbackName: string
): ImportResult {
  const raw = JSON.parse(designText) as Record<string, unknown>
  let manifestName = ''
  if (manifestText) {
    try {
      const m = JSON.parse(manifestText) as { name?: unknown }
      if (typeof m.name === 'string') manifestName = m.name
    } catch {
      // manifest 坏了不挡导入
    }
  }
  if (raw['schemaVersion'] === 1 && typeof raw['tokens'] === 'object') {
    const doc = parseDoc(designText)
    if (manifestName) doc.name = manifestName
    return { doc, applied: Object.keys(doc.tokens).length, skipped: [], sourceLabel: '方案文件' }
  }
  // 导出的 design.json 也是 DTCG;走 DTCG 通道(自家扩展位能还原平台/图标/根字号)
  const r = importDtcgJson(raw, fallbackName)
  if (manifestName) r.doc.name = manifestName
  r.sourceLabel = '方案文件'
  return r
}

// ── 源 2:DTCG token JSON ──

function isTokenNode(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && '$value' in v
}

export function importDtcg(text: string, fallbackName: string): ImportResult {
  return importDtcgJson(JSON.parse(text), fallbackName)
}

function importDtcgJson(root: unknown, fallbackName: string): ImportResult {
  const doc = defaultDoc()
  doc.name = fallbackName
  const c = new Collector()
  const obj = root as Record<string, Json>
  const ext = (obj?.['$extensions'] as Record<string, Json> | undefined)?.[DTCG_EXT] as
    Record<string, Json> | undefined
  const rootPx = typeof ext?.['rootFontPx'] === 'number' ? (ext['rootFontPx'] as number) : 16
  if (typeof ext?.['rootFontPx'] === 'number') doc.rootFontPx = ext['rootFontPx'] as number
  if (ext?.['platform'] === 'phone' || ext?.['platform'] === 'desktop') {
    doc.platform = ext['platform'] as UiPlatform
  }
  doc.device = isDeviceId(doc.platform, ext?.['device'])
    ? (ext?.['device'] as string)
    : defaultDeviceId(doc.platform)
  if (typeof ext?.['template'] === 'string') doc.template = ext['template'] as string
  const icons = ext?.['icons']
  if (typeof icons === 'object' && icons !== null && !Array.isArray(icons)) {
    for (const [slot, name] of Object.entries(icons as Record<string, Json>)) {
      if (typeof name === 'string' && slot in doc.icons) doc.icons[slot as IconSlot] = name
    }
  }
  const darkModes = new Map<string, Json>()

  const walk = (node: Json, path: string[]): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return
    if (isTokenNode(node)) {
      const name = path.join('-')
      const existing = doc.tokens[name]
      if (!existing) {
        c.miss(name)
        return
      }
      const myExt = (node['$extensions'] as Record<string, Json> | undefined)?.[DTCG_EXT] as
        Record<string, Json> | undefined
      const modes = (myExt?.['modes'] as Record<string, Json> | undefined)?.['dark']
      if (modes !== undefined) darkModes.set(name, modes)
      applyToken(doc, c, name, dtcgValue(node, existing.value, rootPx))
      return
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue
      walk(child as Json, [...path, key])
    }
  }
  walk(obj, [])

  // 第二遍:把 modes.dark 里的暗色值并回颜色/阴影变量
  for (const [name, darkJson] of darkModes) {
    const def = doc.tokens[name]
    if (!def) continue
    const v = def.value
    if (v.kind === 'color') {
      const dark = colorObjToRgba(darkJson)
      if (dark) doc.tokens[name] = { ...def, value: { ...v, dark } }
    } else if (v.kind === 'shadow' && typeof darkJson === 'object' && darkJson !== null) {
      const darkColor = colorObjToRgba((darkJson as Record<string, Json>)['color'])
      if (darkColor) doc.tokens[name] = { ...def, value: { ...v, dark: darkColor } }
    }
  }
  if (c.applied === 0 && c.skipped.length > 0) {
    throw new Error('没认出任何变量:文件里的变量名与本方案变量名对不上')
  }
  return { doc, applied: c.applied, skipped: c.skipped, sourceLabel: 'DTCG 变量' }
}

function dtcgValue(
  node: Record<string, Json>,
  existing: TokenValue,
  rootPx: number
): TokenValue | null {
  const v = node['$value']
  if (typeof v === 'string') {
    const r = refName(v)
    if (r) return { kind: 'ref', ref: r }
    return inferValue(v, existing, rootPx)
  }
  const type = node['$type']
  switch (type) {
    case 'color': {
      const css = colorObjToRgba(v)
      return css ? { kind: 'color', light: css, dark: css } : null
    }
    case 'dimension':
    case 'fontSize':
    case 'spacing': {
      const px = dimToPx(v, rootPx)
      return px === null ? null : { kind: 'dimension', px }
    }
    case 'fontWeight':
      return typeof v === 'number' ? { kind: 'fontWeight', value: v } : null
    case 'fontFamily': {
      const families = Array.isArray(v)
        ? v.filter((f): f is string => typeof f === 'string')
        : typeof v === 'string'
          ? [v]
          : null
      return families?.length ? { kind: 'fontFamily', families } : null
    }
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n)) return null
      const myExt = (node['$extensions'] as Record<string, Json> | undefined)?.[DTCG_EXT] as
        Record<string, Json> | undefined
      return myExt?.['unit'] === 'em' ? { kind: 'em', value: n } : { kind: 'number', value: n }
    }
    case 'shadow': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
      const s = v as Record<string, Json>
      const color = colorObjToRgba(s['color'])
      const x = dimToPx(s['offsetX'], rootPx)
      const y = dimToPx(s['offsetY'], rootPx)
      const blur = dimToPx(s['blur'], rootPx)
      const spread = dimToPx(s['spread'], rootPx)
      if (color === null || x === null || y === null || blur === null) return null
      return { kind: 'shadow', x, y, blur, spread: spread ?? 0, light: color, dark: color }
    }
    default:
      return inferValue(String(v ?? ''), existing, rootPx)
  }
}

// ── 源 3:CSS 变量(:root { --x: … } 全文或粘贴片段;兼容 Tailwind v4 @theme)──

/** Tailwind v4 @theme 命名空间 → 本方案变量名前缀(与 adapters.ts 的 TW_NS 互为逆向) */
const TW_IMPORT: Array<[twPrefix: string, ours: string]> = [
  ['spacing-', 'space-'],
  ['text-', 'font-size-'],
  ['leading-', 'line-height-'],
  ['font-weight-', 'font-weight-'],
  ['radius-', 'radius-'],
  ['shadow-', 'shadow-'],
  ['color-', 'color-']
]

/** @theme 变量名 → 本方案变量名;认得的前缀归位,认不得的原样返回(仍按原名匹配) */
function twToToken(name: string): string {
  if (name === 'font-sans') return 'font-family'
  for (const [prefix, ours] of TW_IMPORT) {
    if (name.startsWith(prefix)) return `${ours}${name.slice(prefix.length)}`
  }
  return name
}

const DECL_RE = /--([\w-]+)\s*:\s*([^;{}]+);/g
const DARK_BLOCK_RE = /\[\s*data-theme\s*=\s*['"]?dark['"]?\s*\]\s*\{([^}]*)\}/g

export function importCssVars(text: string, fallbackName: string): ImportResult {
  const doc = defaultDoc()
  doc.name = fallbackName
  const c = new Collector()
  const isTailwind = /@theme\b/.test(text)

  // 暗色块单独摘出:先按 data-theme 块合并颜色的 dark 端,再扫全文的亮色声明
  const darkDecls = new Map<string, string>()
  for (const m of text.matchAll(DARK_BLOCK_RE)) {
    for (const d of m[1]!.matchAll(DECL_RE)) darkDecls.set(d[1]!, d[2]!)
  }
  const lightText = text.replace(DARK_BLOCK_RE, '')

  const decls = new Map<string, string>()
  for (const m of lightText.matchAll(DECL_RE)) {
    decls.set(m[1]!, m[2]!)
  }
  if (decls.size === 0 && darkDecls.size === 0) {
    throw new Error('没在文本里找到 --变量: 值; 形式的声明')
  }
  for (const [rawName, raw] of decls) {
    const name = twToToken(rawName)
    const existing = doc.tokens[name]
    if (!existing) {
      c.miss(rawName)
      continue
    }
    applyToken(doc, c, name, inferValue(raw, existing.value, doc.rootFontPx))
  }
  // 第二遍:暗色块只并回颜色/阴影的 dark 端,不覆盖亮色值
  for (const [rawName, raw] of darkDecls) {
    const name = twToToken(rawName)
    const def = doc.tokens[name]
    if (!def) continue
    const parsed = inferValue(raw, def.value, doc.rootFontPx)
    if (parsed?.kind === 'color' && def.value.kind === 'color') {
      doc.tokens[name] = { ...def, value: { ...def.value, dark: parsed.light } }
      c.applied++
    } else if (parsed?.kind === 'shadow' && def.value.kind === 'shadow') {
      doc.tokens[name] = { ...def, value: { ...def.value, dark: parsed.light } }
      c.applied++
    }
  }
  if (c.applied === 0) throw new Error('一个变量都没对上:--名字 与本方案变量名不一致')
  return {
    doc,
    applied: c.applied,
    skipped: c.skipped,
    sourceLabel: isTailwind ? 'Tailwind @theme' : 'CSS 变量'
  }
}
