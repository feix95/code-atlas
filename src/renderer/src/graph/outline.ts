// 模块轮廓的几何:只贴着本模块成员走的非凸轮廓。
// 做法: 在成员附近的网格上算一张有符号距离场(正 = 轮廓内),成员是外扩 padding 的圆,
// 成员之间沿最小生成树加细连桥;每个非成员节点按「半径 + obstacleGap」挖掉,
// 再用 marching squares 求零值等值线,得到若干闭合环(按奇偶规则填充,挖出的洞自然留空)。
// 纯函数,不依赖 DOM。
export type Point = [number, number]

export interface Circle {
  x: number
  y: number
  r: number
}

export interface OutlineOptions {
  /** 成员圆在半径外追加的留白 */
  padding: number
  /** 成员之间连桥的半宽 */
  bridgeWidth: number
  /** 非成员节点在半径外再让出的距离 */
  obstacleGap: number
  /** 网格边长(世界坐标);范围太大时自动放粗,单边不超过 MAX_CELLS 格 */
  cell: number
}

const MAX_CELLS = 160

interface Grid {
  x0: number
  y0: number
  cell: number
  nx: number
  ny: number
  values: Float32Array
}

function makeGrid(members: Circle[], opts: OutlineOptions): Grid {
  const margin = opts.padding + opts.cell * 3
  const x0 = Math.min(...members.map((c) => c.x - c.r)) - margin
  const y0 = Math.min(...members.map((c) => c.y - c.r)) - margin
  const x1 = Math.max(...members.map((c) => c.x + c.r)) + margin
  const y1 = Math.max(...members.map((c) => c.y + c.r)) + margin
  const cell = Math.max(opts.cell, (x1 - x0) / MAX_CELLS, (y1 - y0) / MAX_CELLS)
  const nx = Math.ceil((x1 - x0) / cell) + 1
  const ny = Math.ceil((y1 - y0) / cell) + 1
  // 远离所有成员的格点统一记为「外」;成员附近的格点下面按真实距离覆盖
  const values = new Float32Array(nx * ny).fill(-cell * 2)
  return { x0, y0, cell, nx, ny, values }
}

/** 对包围盒内的格点套用 combine(旧值, 距离值) */
function splat(
  grid: Grid,
  box: [number, number, number, number],
  sdf: (x: number, y: number) => number,
  combine: (a: number, b: number) => number
): void {
  const { x0, y0, cell, nx, ny, values } = grid
  const i0 = Math.max(0, Math.floor((box[0] - x0) / cell))
  const i1 = Math.min(nx - 1, Math.ceil((box[2] - x0) / cell))
  const j0 = Math.max(0, Math.floor((box[1] - y0) / cell))
  const j1 = Math.min(ny - 1, Math.ceil((box[3] - y0) / cell))
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * nx + i
      values[k] = combine(values[k], sdf(x0 + i * cell, y0 + j * cell))
    }
  }
}

function segmentDistance(px: number, py: number, a: Circle, b: Circle): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.sqrt((px - a.x - t * dx) ** 2 + (py - a.y - t * dy) ** 2)
}

/** Prim 最小生成树:成员两两之间最短的一组连边 */
function spanningEdges(members: Circle[]): Array<[Circle, Circle]> {
  const edges: Array<[Circle, Circle]> = []
  const best = members.map((c) => Math.hypot(c.x - members[0].x, c.y - members[0].y))
  const from = members.map(() => 0)
  const done = members.map((_, i) => i === 0)
  for (let step = 1; step < members.length; step++) {
    let next = -1
    for (let i = 0; i < members.length; i++)
      if (!done[i] && (next < 0 || best[i] < best[next])) next = i
    done[next] = true
    edges.push([members[from[next]], members[next]])
    for (let i = 0; i < members.length; i++) {
      const d = Math.hypot(members[i].x - members[next].x, members[i].y - members[next].y)
      if (!done[i] && d < best[i]) [best[i], from[i]] = [d, next]
    }
  }
  return edges
}

function fillField(grid: Grid, members: Circle[], others: Circle[], opts: OutlineOptions): void {
  const band = grid.cell * 2
  for (const c of members) {
    const radius = c.r + opts.padding
    const reach = radius + band
    splat(
      grid,
      [c.x - reach, c.y - reach, c.x + reach, c.y + reach],
      (x, y) => radius - Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2),
      Math.max
    )
  }
  const half = opts.bridgeWidth
  for (const [a, b] of spanningEdges(members)) {
    const reach = half + band
    const box: [number, number, number, number] = [
      Math.min(a.x, b.x) - reach,
      Math.min(a.y, b.y) - reach,
      Math.max(a.x, b.x) + reach,
      Math.max(a.y, b.y) + reach
    ]
    splat(grid, box, (x, y) => half - segmentDistance(x, y, a, b), Math.max)
  }
  for (const o of others) {
    const radius = o.r + opts.obstacleGap
    const reach = radius + band
    splat(
      grid,
      [o.x - reach, o.y - reach, o.x + reach, o.y + reach],
      (x, y) => Math.sqrt((x - o.x) ** 2 + (y - o.y) ** 2) - radius,
      Math.min
    )
  }
}

// marching squares:四角按 左上 8 / 右上 4 / 右下 2 / 左下 1 编码;边 0 上、1 右、2 下、3 左。
// 鞍点(5、10)按格子中心值决定连法:中心在内则两块内区相连
const CASES: Record<number, Array<[number, number]>> = {
  1: [[3, 2]],
  2: [[2, 1]],
  3: [[3, 1]],
  4: [[0, 1]],
  6: [[0, 2]],
  7: [[3, 0]],
  8: [[3, 0]],
  9: [[0, 2]],
  11: [[0, 1]],
  12: [[3, 1]],
  13: [[2, 1]],
  14: [[3, 2]]
}
const SADDLE_JOINED: Record<number, Array<[number, number]>> = {
  5: [
    [3, 0],
    [2, 1]
  ],
  10: [
    [0, 1],
    [3, 2]
  ]
}
const SADDLE_SPLIT: Record<number, Array<[number, number]>> = {
  5: [
    [0, 1],
    [3, 2]
  ],
  10: [
    [3, 0],
    [2, 1]
  ]
}

/** 网格边的唯一编号:横边 = 格点序号 × 2,竖边 = 格点序号 × 2 + 1 */
function edgeKey(grid: Grid, i: number, j: number, side: number): number {
  const { nx } = grid
  if (side === 0) return (j * nx + i) * 2
  if (side === 2) return ((j + 1) * nx + i) * 2
  if (side === 3) return (j * nx + i) * 2 + 1
  return (j * nx + i + 1) * 2 + 1
}

/** 等值线与该网格边的交点(线性插值) */
function edgePoint(grid: Grid, key: number): Point {
  const { x0, y0, cell, nx, values } = grid
  const k = key >> 1
  const i = k % nx
  const j = (k - i) / nx
  const k2 = key & 1 ? k + nx : k + 1
  const t = values[k] / (values[k] - values[k2])
  return key & 1 ? [x0 + i * cell, y0 + (j + t) * cell] : [x0 + (i + t) * cell, y0 + j * cell]
}

const NO_SEGMENTS: Array<[number, number]> = []

function cellSegments(grid: Grid, i: number, j: number): Array<[number, number]> {
  const { nx, values } = grid
  const tl = values[j * nx + i]
  const tr = values[j * nx + i + 1]
  const br = values[(j + 1) * nx + i + 1]
  const bl = values[(j + 1) * nx + i]
  const code = (tl > 0 ? 8 : 0) | (tr > 0 ? 4 : 0) | (br > 0 ? 2 : 0) | (bl > 0 ? 1 : 0)
  if (code === 0 || code === 15) return NO_SEGMENTS
  const isSaddle = code === 5 || code === 10
  const table = !isSaddle ? CASES : (tl + tr + br + bl) / 4 > 0 ? SADDLE_JOINED : SADDLE_SPLIT
  return (table[code] ?? []).map(([a, b]) => [edgeKey(grid, i, j, a), edgeKey(grid, i, j, b)])
}

/** 把各格的线段按共享的网格边首尾相接成闭合环;每条被穿过的网格边恰好连着两段 */
function traceLoops(grid: Grid): Point[][] {
  const links = new Int32Array(grid.nx * grid.ny * 4).fill(-1)
  const keys: number[] = []
  const attach = (from: number, to: number): void => {
    if (links[from * 2] < 0) {
      links[from * 2] = to
      keys.push(from)
    } else links[from * 2 + 1] = to
  }
  for (let j = 0; j < grid.ny - 1; j++) {
    for (let i = 0; i < grid.nx - 1; i++) {
      for (const [a, b] of cellSegments(grid, i, j)) {
        attach(a, b)
        attach(b, a)
      }
    }
  }
  const loops: Point[][] = []
  const seen = new Uint8Array(grid.nx * grid.ny * 2)
  for (const start of keys) {
    const loop: Point[] = []
    let at = start
    while (at >= 0 && !seen[at]) {
      seen[at] = 1
      loop.push(edgePoint(grid, at))
      const [first, second] = [links[at * 2], links[at * 2 + 1]]
      at = first >= 0 && !seen[first] ? first : second
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

/** 只贴着成员走的轮廓:返回若干闭合环(奇偶规则填充);没有成员返回空数组 */
export function moduleOutline(
  members: Circle[],
  others: Circle[],
  opts: OutlineOptions
): Point[][] {
  if (members.length === 0) return []
  const grid = makeGrid(members, opts)
  fillField(grid, members, others, opts)
  return traceLoops(grid)
}
