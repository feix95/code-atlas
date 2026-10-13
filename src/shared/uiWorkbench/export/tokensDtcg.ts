// 设计数值导出为 W3C Design Tokens(DTCG 2025.10)JSON:画板尺寸 + 每个节点的位置、尺寸、旋转、圆角、填充、描边。
// 尺寸类用 dimension({ value, unit: "px" });颜色用 color({ colorSpace: "srgb", components, alpha, hex });
// 描边用 DTCG border 复合类型({ color, width, style }),口径为「内描边」(同 CSS border-box)。
// DTCG 没有角度类型,旋转用 number 并在 $description 写明单位与方向。
// 填充/描边为 null 时对应 token 整个缺省(缺省 = 不填充/不描边),不写空值。
// 节点结构信息(类型、名字、层级顺序)放在组的 $extensions 里,供 AI agent 按数值复刻。
// 样式以「定义+引用」发出:styles 组存方案定义(与节点数值同口径),节点 $extensions.style 记挂接 id;
// 节点数值仍按展开值发,不依赖样式在不在场——agent 可认链接也可直接复刻。
import { lineAngle, lineLength, round2, type LineNode } from '../line.ts'
import type { LineStyle } from '../lineStyles.ts'
import { CORNER_KEYS, type RectStroke } from '../node.ts'
import type { SceneNode } from '../scene.ts'
import type { RectStyle } from '../styles.ts'
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

const INNER_STROKE_NOTE = '内描边:画在节点轮廓内侧,不外扩(同 CSS border-box 口径)'
const LINE_STROKE_NOTE = '描边居中于线段(同 SVG stroke 口径);线宽即线的粗细'

/** 描边 → DTCG border 复合 token;note 写明该节点类型的描边口径 */
function borderToken(stroke: RectStroke, note: string): Token {
  return {
    $type: 'border',
    $value: {
      color: color(stroke.color).$value,
      width: { value: stroke.width, unit: 'px' },
      style: stroke.style
    },
    $description: note
  }
}

function styleTokens(style: RectStyle): Record<string, unknown> {
  const tokens: Record<string, unknown> = {
    $description: `外观样式「${style.name}」(整包:填充+描边+圆角)。节点 $extensions.style 引用此 id`,
    radius: Object.fromEntries(CORNER_KEYS.map((key, i) => [key, dimension(style.radii[i])]))
  }
  if (style.fill !== null) tokens.fill = color(style.fill)
  if (style.stroke !== null) tokens.stroke = borderToken(style.stroke, INNER_STROKE_NOTE)
  return tokens
}

function lineStyleTokens(style: LineStyle): Record<string, unknown> {
  return {
    $description: `直线样式「${style.name}」(整包:描边+端点样式)。节点 $extensions.style 引用此 id`,
    $extensions: { [DTCG_EXTENSION_KEY]: { cap: style.cap } },
    stroke: borderToken(style.stroke, LINE_STROKE_NOTE)
  }
}

/** 直线:两端点 + 派生的长度/角度;端点样式 cap 放 $extensions(DTCG 没有等价的简单类型) */
function lineTokens(node: LineNode, order: number): Record<string, unknown> {
  return {
    $description: `${node.name}(直线)。起点/终点为相对画板原点的位置,长度与角度由两端点派生`,
    $extensions: {
      [DTCG_EXTENSION_KEY]: {
        nodeType: node.type,
        name: node.name,
        order,
        cap: node.cap,
        ...(node.styleId ? { style: node.styleId } : {})
      }
    },
    x1: dimension(node.x1),
    y1: dimension(node.y1),
    x2: dimension(node.x2),
    y2: dimension(node.y2),
    length: dimension(round2(lineLength(node))),
    angle: {
      $type: 'number',
      $value: round2(lineAngle(node)),
      $description: '方向角(度),起点指向终点,顺时针为正,范围 [0, 360)'
    },
    stroke: borderToken(node.stroke, LINE_STROKE_NOTE)
  }
}

function nodeTokens(node: SceneNode, order: number): Record<string, unknown> {
  if (node.type === 'line') return lineTokens(node, order)
  const radius = Object.fromEntries(CORNER_KEYS.map((key, i) => [key, dimension(node.radii[i])]))
  const tokens: Record<string, unknown> = {
    $description: `${node.name}(矩形)。x/y 为未旋转时左上角相对画板原点的位置`,
    $extensions: {
      [DTCG_EXTENSION_KEY]: {
        nodeType: node.type,
        name: node.name,
        order,
        ...(node.styleId ? { style: node.styleId } : {})
      }
    },
    x: dimension(node.x),
    y: dimension(node.y),
    width: dimension(node.width),
    height: dimension(node.height),
    rotation: {
      $type: 'number',
      $value: node.rotation,
      $description: '旋转角度(度),绕自身中心顺时针为正'
    },
    radius
  }
  if (node.fill !== null) tokens.fill = color(node.fill)
  if (node.stroke !== null) tokens.stroke = borderToken(node.stroke, INNER_STROKE_NOTE)
  return tokens
}

export function toDtcgTokens(doc: WorkbenchDocument): Record<string, unknown> {
  return {
    artboard: {
      $description: '画板(目标屏幕)尺寸,所有节点坐标以其左上角为原点',
      width: dimension(doc.artboard.width),
      height: dimension(doc.artboard.height)
    },
    styles: Object.fromEntries([
      ...(doc.styles ?? []).map((s) => [s.id, styleTokens(s)]),
      ...(doc.lineStyles ?? []).map((s) => [s.id, lineStyleTokens(s)])
    ]),
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
