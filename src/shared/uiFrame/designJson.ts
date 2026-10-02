// design.json(§13.3、规则 14):DTCG 2025.10 格式的纯数据,与 tokens.css 同源生成。
// 亮暗两套:$value 为亮色,暗色写在 $extensions 的 modes 里。
import { remNumber } from './units.ts'
import type { TokenDef, TokenValue, UiFrameDoc } from './types.ts'

export const DTCG_EXT = 'com.codeatlas.uiframe'

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

function hexComponents(hex: string): number[] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => Number((parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)))
}

function colorValue(hex: string): Json {
  return { colorSpace: 'srgb', components: hexComponents(hex), alpha: 1, hex: hex.toLowerCase() }
}

/** 颜色文本 → DTCG 颜色对象:#rrggbb 走 hex 通道,rgba() 等带 alpha 的走分量通道 */
function anyColorValue(text: string): Json {
  return /^#[0-9a-fA-F]{6}$/.test(text) ? colorValue(text) : rgbaValue(text)
}

/** rgba(r, g, b, a) → DTCG 颜色对象 */
function rgbaValue(rgba: string): Json {
  const m = /rgba?\(([^)]+)\)/.exec(rgba)
  const parts = (m?.[1] ?? '0,0,0,1').split(',').map((s) => Number(s.trim()))
  return {
    colorSpace: 'srgb',
    components: parts.slice(0, 3).map((c) => Number((c / 255).toFixed(4))),
    alpha: parts[3] ?? 1
  }
}

const dim = (px: number, root: number): Json => ({ value: remNumber(px, root), unit: 'rem' })

function typedValue(
  value: TokenValue,
  tokens: UiFrameDoc['tokens'],
  root: number
): { type: string; value: Json; dark?: Json; unit?: string } {
  switch (value.kind) {
    case 'ref': {
      const target = tokens[value.ref]
      const inner = typedValue(target.value, tokens, root)
      return { type: inner.type, value: `{${target.path.join('.')}}` }
    }
    case 'color':
      return { type: 'color', value: anyColorValue(value.light), dark: anyColorValue(value.dark) }
    case 'dimension':
      return { type: 'dimension', value: dim(value.px, root) }
    case 'em':
      return { type: 'number', value: value.value, unit: 'em' }
    case 'number':
      return { type: 'number', value: value.value }
    case 'fontWeight':
      return { type: 'fontWeight', value: value.value }
    case 'fontFamily':
      return { type: 'fontFamily', value: value.families }
    case 'shadow': {
      const base = {
        offsetX: dim(value.x, root),
        offsetY: dim(value.y, root),
        blur: dim(value.blur, root),
        spread: dim(value.spread, root)
      }
      return {
        type: 'shadow',
        value: { color: rgbaValue(value.light), ...base },
        dark: { color: rgbaValue(value.dark), ...base }
      }
    }
  }
}

function tokenJson(def: TokenDef, doc: UiFrameDoc): Json {
  const t = typedValue(def.value, doc.tokens, doc.rootFontPx)
  const ext: Record<string, Json> = { tier: def.tier, label: def.label }
  if (t.dark !== undefined) ext['modes'] = { dark: t.dark }
  if (t.unit) ext['unit'] = t.unit
  return { $type: t.type, $value: t.value, $extensions: { [DTCG_EXT]: ext } }
}

export function designJson(doc: UiFrameDoc): string {
  const root: Record<string, Json> = {
    $description: `${doc.name} · UI 规格数据(DTCG 2025.10)。亮色为 $value,暗色见 $extensions.modes.dark`,
    $extensions: {
      [DTCG_EXT]: {
        schemaVersion: doc.schemaVersion,
        platform: doc.platform,
        device: doc.device,
        rootFontPx: doc.rootFontPx,
        themes: ['light', 'dark'],
        icons: doc.icons
      }
    }
  }
  for (const def of Object.values(doc.tokens)) {
    const [group, name] = def.path
    const bucket = (root[group] ??= {}) as Record<string, Json>
    bucket[name] = tokenJson(def, doc)
  }
  return `${JSON.stringify(root, null, 2)}\n`
}
