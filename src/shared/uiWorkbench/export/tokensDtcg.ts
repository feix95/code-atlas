// 设计数值导出为 W3C Design Tokens(DTCG 2025.10)JSON:画板尺寸 + 每个节点的位置、尺寸、旋转、圆角、填充。
// 尺寸类用 dimension({ value, unit: "px" });颜色用 color({ colorSpace: "srgb", components, alpha, hex });
// DTCG 没有角度类型,旋转用 number 并在 $description 写明单位与方向。
// 节点结构信息(类型、名字、层级顺序)放在组的 $extensions 里,供 AI agent 按数值复刻。
import { CORNER_KEYS, type RectNode } from '../node.ts'
import type { ExportFormat, WorkbenchDocument } from './types.ts'

export const DTCG_EXTENSION_KEY = 'app.codeatlas.ui-workbench'

interface Token {
  $type: string
  $value: unknown
  $description?: string
}

function dimension(value: number): Token {
  return { $type: 'dimension', $value: { value, unit: 'px' } }
}

/** #rrggbb → sRGB 分量(0–1,保留 4 位小数) */
export function hexToSrgb(hex: string): [number, number, number] {
  const channel = (i: number): number =>
    Math.round((parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255) * 1e4) / 1e4
  return [channel(0), channel(1), channel(2)]
}

function color(hex: string): Token {
  return {
    $type: 'color',
    $value: { colorSpace: 'srgb', components: hexToSrgb(hex), alpha: 1, hex }
  }
}

function nodeTokens(node: RectNode, order: number): Record<string, unknown> {
  const radius = Object.fromEntries(CORNER_KEYS.map((key, i) => [key, dimension(node.radii[i])]))
  return {
    $description: `${node.name}(矩形)。x/y 为未旋转时左上角相对画板原点的位置`,
    $extensions: { [DTCG_EXTENSION_KEY]: { nodeType: node.type, name: node.name, order } },
    x: dimension(node.x),
    y: dimension(node.y),
    width: dimension(node.width),
    height: dimension(node.height),
    rotation: {
      $type: 'number',
      $value: node.rotation,
      $description: '旋转角度(度),绕自身中心顺时针为正'
    },
    radius,
    fill: color(node.fill)
  }
}

export function toDtcgTokens(doc: WorkbenchDocument): Record<string, unknown> {
  return {
    artboard: {
      $description: '画板(目标屏幕)尺寸,所有节点坐标以其左上角为原点',
      width: dimension(doc.artboard.width),
      height: dimension(doc.artboard.height)
    },
    nodes: Object.fromEntries(doc.nodes.map((n, i) => [n.id, nodeTokens(n, i)]))
  }
}

export const TOKENS_FORMAT: ExportFormat = {
  id: 'tokens',
  label: '设计数值 tokens.json',
  tip: 'W3C Design Tokens(DTCG)标准 JSON,任何平台与 AI 都能按数值读取',
  fileName: 'ui-workbench.tokens.json',
  mimeType: 'application/json',
  serialize: (doc) => `${JSON.stringify(toDtcgTokens(doc), null, 2)}\n`
}
