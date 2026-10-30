// 模块颜色 token:每个模块一个全局固定的颜色序号,同一模块在每一层、轮廓、色环、侧栏都是同一个颜色。
// 前 GRAPH_MODULE_COLORS 个模块用手挑的调色板(--graph-module-1 至 -N);之后的按黄金角错开色相、
// 明暗两档交替生成,不循环、不撞色;用户在右键菜单改过的颜色优先。纯函数,不依赖 DOM。
import { GRAPH_MODULE_COLORS, GRAPH_MODULE_GEN } from './graphConfig.ts'

/** 生成色的饱和度与两档明度(百分数),随亮暗主题从 --graph-module-gen-* 读 */
export interface GenTone {
  sat: number
  lightA: number
  lightB: number
}

/** 用户改过的模块颜色:模块 id → #rrggbb */
export type ColorOverrides = ReadonlyMap<string, string>

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

/** 第 index 个模块的生成色相(度);index 小于调色板色数时不会用到 */
export function generatedHue(index: number): number {
  const n = index - GRAPH_MODULE_COLORS
  return Math.round((GRAPH_MODULE_GEN.hueStart + n * GRAPH_MODULE_GEN.hueStep) % 360)
}

function isLightA(index: number): boolean {
  return (index - GRAPH_MODULE_COLORS) % 2 === 0
}

/** Canvas 用的颜色:改过的颜色 → 调色板 → 生成色;没有归属模块用中性色 */
export function moduleColor(
  index: number | undefined,
  override: string | undefined,
  palette: readonly string[],
  tone: GenTone,
  neutral: string
): string {
  if (override) return override
  if (index === undefined) return neutral
  if (index < palette.length) return palette[index] || neutral
  const light = isLightA(index) ? tone.lightA : tone.lightB
  return `hsl(${generatedHue(index)}, ${tone.sat}%, ${light}%)`
}

/** DOM 用的颜色(侧栏色块):走 CSS 变量,切换主题时跟着变 */
export function moduleSwatchCss(index: number | undefined, override: string | undefined): string {
  if (override) return override
  if (index === undefined) return 'var(--graph-module-neutral)'
  if (index < GRAPH_MODULE_COLORS) return `var(--graph-module-${index + 1})`
  const light = isLightA(index)
    ? 'var(--graph-module-gen-light-a)'
    : 'var(--graph-module-gen-light-b)'
  return `hsl(${generatedHue(index)}, var(--graph-module-gen-sat), ${light})`
}

/** 每个项目一份:项目根路径 → (模块 id → #rrggbb) */
export type ModuleColorPrefs = Record<string, Record<string, string>>

/** 一个项目最多记住的改色条数;超出时丢掉最早写入的 */
export const MAX_OVERRIDES_PER_ROOT = 200

/** 读存档时清洗:只留字符串键 + 合法 #rrggbb 值,其余静默丢弃 */
export function sanitizeModuleColorPrefs(raw: unknown): ModuleColorPrefs {
  const out: ModuleColorPrefs = {}
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

/** 改一个模块的颜色;color 为 null = 恢复默认 */
export function setModuleColorIn(
  prefs: ModuleColorPrefs,
  root: string,
  moduleId: string,
  color: string | null
): ModuleColorPrefs {
  const current = { ...(prefs[root] ?? {}) }
  delete current[moduleId]
  if (color !== null && isHexColor(color)) current[moduleId] = color.toLowerCase()
  const entries = Object.entries(current).slice(-MAX_OVERRIDES_PER_ROOT)
  const next = { ...prefs }
  if (entries.length === 0) delete next[root]
  else next[root] = Object.fromEntries(entries)
  return next
}
