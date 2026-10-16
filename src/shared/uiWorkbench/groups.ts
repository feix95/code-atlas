// 样式组(纯逻辑,无 React / DOM):把选中的若干对象(矩形、直线)存成一份可复用的 JSON 片段。
// 片段里的坐标是相对坐标——整组外接框左上角为 (0,0),放进画板时再整体平移到落点;
// 放入的是散开的普通对象(id 重新编号),与片段不再有关联,可随意拆开、改动。
// 存档反序列化逐字段校验,坏条目丢弃(与样式库同一口径)。
import { applyLinePatch, LINE_CAPS, type LineCap, type LineNode } from './line.ts'
import { applyRectPatch, createRect, type RectNode } from './node.ts'
import {
  applyNodeAction,
  cloneNode,
  snapshotNode,
  translatePatch,
  unionBox,
  type SceneNode
} from './scene.ts'
import {
  normalizeStyleName,
  STYLE_NAME_MAX,
  STYLES_MAX,
  isHex,
  isRecord,
  toRadii,
  toStroke
} from './styles.ts'
import type { Point } from './geometry.ts'

export interface StyleGroup {
  id: string
  name: string
  /** 相对坐标:整组外接框左上角 = (0,0);绘制顺序保留 */
  nodes: SceneNode[]
}

export const GROUP_NAME_FALLBACK_PREFIX = '样式组'

/** 选中对象 → 样式组:深拷贝并整体平移到以原点为左上角 */
export function buildGroup(
  id: string,
  rawName: string,
  seq: number,
  selected: readonly SceneNode[]
): StyleGroup {
  const box = unionBox(selected)
  const nodes = selected.map((n) => {
    const copy = snapshotNode(n)
    return applyNodeAction([copy], {
      type: 'update',
      id: copy.id,
      patch: translatePatch(copy, -box.x, -box.y)
    })[0]
  })
  return { id, name: normalizeStyleName(rawName, seq, GROUP_NAME_FALLBACK_PREFIX), nodes }
}

/** 列表里的一句说明:里面有几个矩形、几条直线 */
export function describeGroup(group: StyleGroup): string {
  const rects = group.nodes.filter((n) => n.type === 'rect').length
  const lines = group.nodes.length - rects
  return [rects > 0 && `${rects} 个矩形`, lines > 0 && `${lines} 条直线`]
    .filter(Boolean)
    .join(' · ')
}

/** 样式组外接框尺寸(放入时据此居中) */
export function groupSize(group: StyleGroup): { width: number; height: number } {
  const { width, height } = unionBox(group.nodes)
  return { width, height }
}

/** 放入画板:逐个克隆(序号在「含已放入节点」的列表上重算,一次放入内 id 不撞车),
 *  topLeft 为整组外接框左上角的落点;返回新节点,调用方负责 add 与选中 */
export function instantiateGroup(
  group: StyleGroup,
  existing: readonly SceneNode[],
  topLeft: Point
): SceneNode[] {
  const made: SceneNode[] = []
  for (const src of group.nodes) {
    made.push(cloneNode(src, [...existing, ...made], topLeft))
  }
  return made
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function toRect(value: Record<string, unknown>): RectNode | null {
  const { name, x, y, width, height, rotation, radii, fill, stroke, styleId } = value
  const r = toRadii(radii)
  const s = stroke === null ? null : toStroke(stroke)
  const isValid =
    typeof name === 'string' &&
    [x, y, width, height, rotation].every(isNumber) &&
    r !== null &&
    (fill === null || isHex(fill)) &&
    (stroke === null || s !== null) &&
    (styleId === null || typeof styleId === 'string')
  if (!isValid) return null
  return applyRectPatch(
    {
      ...createRect([], {
        x: x as number,
        y: y as number,
        width: width as number,
        height: height as number
      }),
      name,
      visible: value.visible !== false,
      locked: value.locked === true,
      rotation: rotation as number,
      radii: r,
      fill: fill as string | null,
      stroke: s,
      styleId: styleId as string | null
    },
    {}
  )
}

function toLine(value: Record<string, unknown>): LineNode | null {
  const { name, x1, y1, x2, y2, stroke, cap, styleId } = value
  const s = toStroke(stroke)
  const isValid =
    typeof name === 'string' &&
    [x1, y1, x2, y2].every(isNumber) &&
    s !== null &&
    LINE_CAPS.includes(cap as LineCap) &&
    (styleId === null || typeof styleId === 'string')
  if (!isValid) return null
  return applyLinePatch(
    {
      id: 'line-1',
      type: 'line',
      name,
      visible: value.visible !== false,
      locked: value.locked === true,
      x1: x1 as number,
      y1: y1 as number,
      x2: x2 as number,
      y2: y2 as number,
      stroke: s,
      cap: cap as LineCap,
      styleId: styleId as string | null
    },
    {}
  )
}

/** 片段内节点:id 一律重编(片段里的 id 只是占位,放入时 cloneNode 会重算),坏节点整条丢 */
function toSceneNode(value: unknown, index: number): SceneNode | null {
  if (!isRecord(value)) return null
  const node = value.type === 'rect' ? toRect(value) : value.type === 'line' ? toLine(value) : null
  return node && { ...node, id: `${node.type}-${index + 1}` }
}

function toGroup(value: unknown): StyleGroup | null {
  if (!isRecord(value)) return null
  const { id, name, nodes } = value
  if (typeof id !== 'string' || id === '') return null
  if (typeof name !== 'string' || name.trim() === '') return null
  if (!Array.isArray(nodes) || nodes.length === 0) return null
  const parsed = nodes.map(toSceneNode)
  // 片段里有一个坏节点就整组丢弃:缺一块的组放进去会是残缺的界面
  if (parsed.some((n) => n === null)) return null
  return { id, name: name.trim().slice(0, STYLE_NAME_MAX), nodes: parsed as SceneNode[] }
}

/** 已 JSON.parse 的存档 → 合法样式组列表;坏条目丢弃,超限截断 */
export function sanitizeGroups(value: unknown): StyleGroup[] {
  if (!Array.isArray(value)) return []
  return value
    .map(toGroup)
    .filter((g): g is StyleGroup => g !== null)
    .slice(0, STYLES_MAX)
}
