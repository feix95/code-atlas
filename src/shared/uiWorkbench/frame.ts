// 画板节点(纯逻辑,无 React / DOM):Figma 的 Frame —— 页面里的一个普通对象,有位置、尺寸、填充,
// 并且是容器:后代的 parentId 指向它,画布上被它的边界裁切,导出时一个画板 = 一份产物。
// 字段形状与矩形一致(几何、命中、缩放手势直接复用),但这一版画板固定不旋转、无圆角、无描边、不挂样式:
// 这些字段恒为 0 / null,补丁里即使带了也被丢弃,保证画布裁切与导出口径一致。
import { applyRectPatch, createRect, type RectNode } from './node.ts'

export type FrameNode = Omit<RectNode, 'type'> & { type: 'frame' }

/** 有位置、宽高、填充的盒子类节点:矩形与画板(几何、命中、缩放手势共用) */
export type BoxNode = RectNode | FrameNode

export type FramePatch = Partial<
  Pick<
    FrameNode,
    'x' | 'y' | 'width' | 'height' | 'fill' | 'name' | 'visible' | 'locked' | 'parentId'
  >
>

/** 新画板默认填充:白(与导出里的画板底色同一口径) */
export const FRAME_DEFAULT_FILL = '#ffffff'

const FRAME_PATCH_KEYS: readonly (keyof FramePatch)[] = [
  'x',
  'y',
  'width',
  'height',
  'fill',
  'name',
  'visible',
  'locked',
  'parentId'
]

/** 画板补丁落地:复用矩形的取整/钳边界/校验,再把不支持的字段压回固定值 */
export function applyFramePatch(node: FrameNode, patch: FramePatch): FrameNode {
  const allowed = Object.fromEntries(
    Object.entries(patch).filter(([k]) => (FRAME_PATCH_KEYS as readonly string[]).includes(k))
  ) as FramePatch
  const next = applyRectPatch({ ...node, type: 'rect' }, allowed)
  return { ...next, type: 'frame', rotation: 0, radii: [0, 0, 0, 0], stroke: null, styleId: null }
}

function nextSeq(nodes: readonly { id: string }[]): number {
  const used = nodes.map((n) => Number(/^frame-(\d+)$/.exec(n.id)?.[1] ?? 0))
  return Math.max(0, ...used) + 1
}

/** 新画板的 id 与名字:序号取现有最大值 + 1(删掉的号不复用) */
export function createFrame(
  nodes: readonly { id: string }[],
  box: Pick<FrameNode, 'x' | 'y' | 'width' | 'height'>,
  parentId: string | null = null
): FrameNode {
  const seq = nextSeq(nodes)
  const base = createRect([], box)
  return applyFramePatch(
    { ...base, type: 'frame', id: `frame-${seq}`, name: `画板 ${seq}`, fill: FRAME_DEFAULT_FILL },
    { parentId }
  )
}

/** 克隆画板(不含后代,后代由 tree.ts 的 cloneNodes 带上):序号规则同 createFrame,按 offset 平移 */
export function cloneFrame(
  source: FrameNode,
  nodes: readonly { id: string }[],
  offset: { x: number; y: number }
): FrameNode {
  const seq = nextSeq(nodes)
  return applyFramePatch(
    { ...source, id: `frame-${seq}`, name: `画板 ${seq}` },
    { x: source.x + offset.x, y: source.y + offset.y }
  )
}
