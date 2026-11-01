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
