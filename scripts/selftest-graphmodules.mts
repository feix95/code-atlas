// 关系图谱划分(P1)的纯函数自测:凸包轮廓、模块叠加层(轮廓成员、分段色环、配色)、聚类力、模块显示名。
import assert from 'node:assert/strict'
import { circleHull, convexHull, type Point } from '../src/renderer/src/graph/hull.ts'
import {
  buildModuleOverlay,
  moduleDisplayName,
  NEUTRAL_SEGMENT
} from '../src/renderer/src/graph/moduleOverlay.ts'
import { forceCluster } from '../src/renderer/src/graph/forceCluster.ts'
import {
  folderComposition,
  moduleDetails,
  unassignedReason
} from '../src/renderer/src/graph/moduleDetails.ts'
import { fitTransform, shouldAutoFit } from '../src/renderer/src/graph/fitView.ts'
import type { ForceScene } from '../src/renderer/src/graph/useForceLayout.ts'
import type { LevelNode } from '../src/shared/graphView.ts'
import type { ModuleInfo, ModuleMap } from '../src/shared/types.ts'

function checkConvexHull(): void {
  const square: Point[] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [1, 1],
    [1, 0]
  ]
  assert.deepEqual(
    convexHull(square),
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2]
    ],
    '内部点与边上共线点不进凸包,按逆时针从最左下点开始'
  )
  assert.deepEqual(convexHull([[1, 1]]), [[1, 1]])
  assert.deepEqual(convexHull([]), [])
  assert.deepEqual(
    convexHull([
      [0, 0],
      [1, 1],
      [2, 2]
    ]),
    [
      [0, 0],
      [2, 2]
    ],
    '全共线时只留两端'
  )
}

/** 点在凸多边形内(含边上):逆时针多边形每条边的叉积都不为负 */
function insideConvex(poly: Point[], [x, y]: Point): boolean {
  return poly.every(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length]
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= -1e-6
  })
}

function checkCircleHull(): void {
  const circles = [
    { x: 0, y: 0, r: 5 },
    { x: 60, y: 10, r: 8 },
    { x: 20, y: 50, r: 6 }
  ]
  const poly = circleHull(circles, 10, 16)
  assert.ok(poly.length >= 3, '三个圆应得到多边形')
  for (const c of circles) {
    for (let a = 0; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2
      const p: Point = [c.x + Math.cos(t) * (c.r + 9), c.y + Math.sin(t) * (c.r + 9)]
      assert.ok(insideConvex(poly, p), '成员圆外扩 padding 后整个落在轮廓内')
    }
  }
  assert.ok(circleHull([{ x: 0, y: 0, r: 5 }], 10, 16).length > 3, '单个圆也能画成圆形轮廓')
}

function mod(id: string, files: string[], extra: Partial<ModuleInfo> = {}): ModuleInfo {
  const anchor = id.slice(2)
  const folder = anchor.includes('/') ? anchor.slice(0, anchor.lastIndexOf('/')) : ''
  return { id, anchor, folder, files, attached: [], tests: [], folders: [folder], ...extra }
}

function makeMap(modules: ModuleInfo[]): ModuleMap {
  const fileToModule: Record<string, string> = {}
  for (const m of modules) for (const f of m.files) fileToModule[f] = m.id
  return {
    algorithmVersion: 3,
    params: {
      resolution: 1,
      seed: 1,
      folderAffinity: 1,
      minFiles: 2,
      hubMinInDegree: 10,
      hubShare: 0.05
    },
    modules,
    fileToModule,
    links: []
  }
}

const node = (id: string, kind: LevelNode['kind']): LevelNode => ({
  id,
  kind,
  label: id.split('/').pop() ?? id,
  degree: 0,
  descendantFiles: 0
})

function checkOverlay(): void {
  const map = makeMap([
    mod('m:src/ui/App.tsx', [
      'src/ui/App.tsx',
      'src/ui/a.ts',
      'src/ui/b.ts',
      'src/ui/c.ts',
      'src/mixed/u1.ts',
      'src/main.ts'
    ]),
    mod('m:src/core/x.ts', ['src/core/x.ts', 'src/core/y.ts', 'src/mixed/c1.ts']),
    mod('m:src/solo/s.ts', ['src/solo/s.ts', 'src/solo/t.ts'])
  ])
  const nodes = [
    node('src/ui', 'folder'),
    node('src/core', 'folder'),
    node('src/mixed', 'folder'),
    node('src/main.ts', 'file'),
    node('src/loose.md', 'file'),
    node('src/solo', 'folder'),
    node('lib/ext.ts', 'external'),
    node('src::overflow', 'overflow')
  ]
  const overlay = buildModuleOverlay(nodes, 'src', map)
  const at = (id: string): { hull: string | null; ring: string[] } => {
    const info = overlay.nodes.get(id)
    return {
      hull: info?.hullModule ?? null,
      ring: info?.ring.map((s) => s.moduleId ?? NEUTRAL_SEGMENT) ?? []
    }
  }
  assert.deepEqual(
    at('src/main.ts'),
    { hull: 'm:src/ui/App.tsx', ring: [] },
    '文件节点属于它的模块'
  )
  assert.deepEqual(
    at('src/ui'),
    { hull: 'm:src/ui/App.tsx', ring: ['m:src/ui/App.tsx'] },
    '全属一个模块的文件夹:计入轮廓,整圈同色'
  )
  assert.deepEqual(
    at('src/mixed'),
    { hull: null, ring: ['m:src/core/x.ts', 'm:src/ui/App.tsx'] },
    '各占一半的文件夹不计入任何轮廓,只画分段色环(平票按 id 排)'
  )
  assert.deepEqual(at('src/loose.md'), { hull: null, ring: [] }, '未归类文件不计入轮廓')
  assert.deepEqual(at('lib/ext.ts'), { hull: null, ring: [] }, '外部节点不画轮廓')
  assert.deepEqual(at('src::overflow'), { hull: null, ring: [] })
  const shares = overlay.nodes.get('src/mixed')?.ring.map((s) => s.share)
  assert.deepEqual(shares, [0.5, 0.5], '分段弧长按文件数占比')
  assert.deepEqual(
    [...overlay.hulls.keys()],
    ['m:src/ui/App.tsx'],
    '同一模块有 2 个及以上可见成员才画轮廓(solo 只有 1 个可见节点)'
  )
  assert.deepEqual(overlay.hulls.get('m:src/ui/App.tsx'), ['src/ui', 'src/main.ts'])
  assert.equal(overlay.colorOf.get('m:src/ui/App.tsx'), 0, '模块按文件数降序取色')
  assert.equal(overlay.colorOf.get('m:src/core/x.ts'), 1)

  const many = makeMap(
    Array.from({ length: 9 }, (_, i) =>
      mod(`m:p/d${i}/f.ts`, [`p/d${i}/f.ts`, `p/d${i}/g.ts`, ...(i === 0 ? ['p/d0/h.ts'] : [])])
    )
  )
  const ring = buildModuleOverlay([node('p', 'folder')], '', many).nodes.get('p')?.ring ?? []
  assert.equal(ring.length, 6, '最多 6 段')
  assert.equal(ring[5].moduleId, null, '超出的模块合并成中性色一段')
  assert.ok(Math.abs(ring.reduce((s, r) => s + r.share, 0) - 1) < 1e-9, '各段占比之和为 1')
  assert.equal(ring[0].moduleId, 'm:p/d0/f.ts', '文件最多的模块排第一段')
  assert.equal(many.modules.length, 9)
  assert.equal(
    buildModuleOverlay([node('p', 'folder')], '', many).colorOf.get('m:p/d8/f.ts'),
    0,
    '调色板 8 色循环'
  )

  const none = buildModuleOverlay(nodes, 'src', null)
  assert.equal(none.nodes.size, 0, '没有模块数据时叠加层为空(画面与改造前一致)')
  assert.equal(none.hulls.size, 0)
}

function checkClusterForce(): void {
  type N = { id: string; x: number; y: number; vx: number; vy: number }
  const nodes: N[] = [
    { id: 'a', x: -100, y: 0, vx: 0, vy: 0 },
    { id: 'b', x: 100, y: 0, vx: 0, vy: 0 },
    { id: 'c', x: 0, y: 300, vx: 0, vy: 0 }
  ]
  const force = forceCluster<N>((n) => (n.id === 'c' ? null : 'm:1'), 0.1)
  force.initialize(nodes)
  force(1)
  assert.ok(nodes[0].vx > 0 && nodes[1].vx < 0, '同模块节点被拉向质心')
  assert.equal(nodes[2].vx, 0, '未归类节点不受聚类力')
  assert.equal(nodes[2].vy, 0)
  force.strength(0)
  const before = nodes[0].vx
  force(1)
  assert.equal(nodes[0].vx, before, '强度 0(关闭模块着色)时不施力')
}

function checkDisplayName(): void {
  assert.equal(
    moduleDisplayName(mod('m:src/renderer/src/graph/useForceLayout.ts', ['a', 'b', 'c'])),
    'graph · useForceLayout.ts'
  )
  assert.equal(moduleDisplayName(mod('m:main.ts', ['main.ts', 'b.ts'])), '根目录 · main.ts')
}

function checkDetails(): void {
  const map = makeMap([
    mod(
      'm:src/ui/App.tsx',
      [
        'src/shared/types.ts',
        'src/ui/App.tsx',
        'src/ui/app.css',
        'src/ui/logo.png',
        'scripts/t.mts'
      ],
      {
        attached: ['src/ui/app.css', 'src/ui/logo.png'],
        tests: ['scripts/t.mts'],
        folders: ['scripts', 'src/shared', 'src/ui']
      }
    ),
    mod('m:src/core/x.ts', ['src/core/x.ts', 'src/core/y.ts']),
    mod('m:lib/z.ts', ['lib/z.ts', 'lib/w.ts'])
  ])
  map.links = [
    { from: 'm:src/ui/App.tsx', to: 'm:src/core/x.ts', weight: 3 },
    { from: 'm:src/ui/App.tsx', to: 'm:lib/z.ts', weight: 5 },
    { from: 'm:src/core/x.ts', to: 'm:src/ui/App.tsx', weight: 1 }
  ]
  const d = moduleDetails(map, 'm:src/ui/App.tsx', 'src/ui')
  assert.ok(d)
  assert.equal(d.name, 'ui · App.tsx')
  assert.deepEqual(
    d.groups.map((g) => [g.folder, g.files.map((f) => [f.name, f.role, f.isElsewhere])]),
    [
      ['src/shared', [['types.ts', 'member', true]]],
      [
        'src/ui',
        [
          ['App.tsx', 'member', false],
          ['logo.png', 'attached', false]
        ]
      ]
    ],
    '成员按文件夹分组;不在当前文件夹的标出来;样式与自测单列'
  )
  assert.deepEqual(d.styles, ['src/ui/app.css'])
  assert.deepEqual(d.tests, ['scripts/t.mts'])
  assert.deepEqual(
    d.dependsOn.map((l) => [l.name, l.weight]),
    [
      ['lib · z.ts', 5],
      ['core · x.ts', 3]
    ],
    '依赖的模块按引用条数降序'
  )
  assert.deepEqual(
    d.usedBy.map((l) => l.moduleId),
    ['m:src/core/x.ts']
  )
  assert.equal(moduleDetails(map, 'm:nope', ''), null)
  assert.deepEqual(
    folderComposition(map, 'src').map((s) => [s.moduleId, s.files]),
    [
      ['m:src/ui/App.tsx', 4],
      ['m:src/core/x.ts', 2]
    ],
    '文件夹的模块构成按文件数降序'
  )
  assert.match(unassignedReason('README.md'), /根目录/)
  assert.match(unassignedReason('docs/a.md'), /没有可划分/)
}

/** 首次稳定后的自动适应:节点出界要缩小,整体挤在画布中间一小块也要放大;已经铺满就不动 */
function checkAutoFit(): void {
  const sceneOf = (points: Array<[number, number]>): ForceScene =>
    ({
      dirRel: '',
      links: [],
      nodes: points.map(([x, y], i) => ({ id: `n${i}`, x, y, r: 10 }))
    }) as unknown as ForceScene
  const size = { w: 1000, h: 800, dpr: 1 }
  const origin = { k: 1, x: size.w / 2, y: size.h / 2 }
  const small = sceneOf([
    [-120, -90],
    [120, 90],
    [0, 0]
  ])
  assert.equal(shouldAutoFit(small, origin, size), true, '只占画布一小块时自动放大')
  const fitted = fitTransform(small, size)
  assert.ok(fitted && fitted.k > 1, '放大后比例大于 1')
  assert.ok(fitted && fitted.k <= 1.5, '放大有上限,三两个节点不会被放得巨大')
  assert.equal(
    shouldAutoFit(small, { k: 1.5, ...{ x: 500, y: 400 } }, size),
    false,
    '已到放大上限不再动'
  )
  const wide = sceneOf([
    [-800, 0],
    [800, 0]
  ])
  assert.equal(shouldAutoFit(wide, origin, size), true, '节点出界时自动缩小')
  const snug = sceneOf([
    [-400, -300],
    [400, 300]
  ])
  assert.equal(shouldAutoFit(snug, origin, size), false, '已基本铺满画布时不动')
  assert.equal(fitTransform(sceneOf([]), size), null, '空场景不适应')
}

checkConvexHull()
checkCircleHull()
checkDetails()
checkOverlay()
checkClusterForce()
checkDisplayName()
checkAutoFit()
console.log('selftest-graphmodules: 全部通过')
