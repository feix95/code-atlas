// 图谱节点详情浮窗自测:活动范围(顶栏让位、四边留缝)、默认落点、拖动夹边、
// 右下角拉伸(左上角钉住、拉不出画布)、画布变小后旧位置夹回、宽高吸回内容尺寸。
// 通用夹边/拖动/拉伸算法与大纲浮窗共用 selftest-outline 已覆盖的那一套,这里盯图谱自己的范围换算。
import assert from 'node:assert/strict'
import {
  DEFAULT_PLACEMENT,
  SNAP_SLACK_PX,
  capToContent,
  clampPlacement,
  movePlacement,
  resizePlacement,
  settleResize,
  snapFrame
} from '../src/renderer/src/floatPlacement.ts'
import { graphPanelBounds } from '../src/renderer/src/graph/graphPanelBounds.ts'
import {
  graphPanelKindOf,
  graphPanelSections,
  mergeVisibleOrder,
  orderGraphPanelSections,
  parseHiddenSections,
  parseSectionOrders
} from '../src/renderer/src/graph/graphPanelSections.ts'
import { folderContents } from '../src/renderer/src/graph/folderContents.ts'
import { availableGraphPanelSections } from '../src/renderer/src/graph/graphPanelAvailability.ts'
import { moduleNamesOf } from '../src/renderer/src/graph/moduleNames.ts'
import { DEFAULT_MODULE_PARAMS } from '../src/modules/moduleConfig.ts'
import { folderTree } from '../src/shared/hierarchy.ts'
import type { DepGraphNode, ModuleInfo, ModuleMap, ScanDirNode } from '../src/shared/types.ts'
import type { WikiPanelPage } from '../src/shared/wikiTypes.ts'
import {
  GRAPH_PREVIEW_NODES,
  type LevelNode,
  type LevelNodeKind
} from '../src/shared/visibleGraph.ts'

/** 画布 1000x800,顶栏让出 48,缝 8,浮窗 304x400,最小 192x96,自适应档宽 512(32rem) */
function sample(
  view = { width: 1000, height: 800 },
  panel = { width: 304, height: 400 },
  natural = { width: null as number | null, height: null as number | null }
) {
  return graphPanelBounds({
    view,
    panel,
    gap: 8,
    topInset: 48,
    min: { width: 192, height: 96 },
    natural,
    autoMaxWidth: 512
  })
}

function checkBounds(): void {
  const b = sample()
  assert.equal(b.minRight, 8, '右缘贴画布边留缝')
  assert.equal(b.minTop, 48, '上缘不压顶栏')
  assert.equal(b.defaultTop, 48, '没拖过落在顶栏之下')
  assert.equal(b.maxRight, 992 - 304, '往左最多挪到浮窗左缘贴缝')
  assert.equal(b.maxTop, 792 - 400, '往下最多挪到浮窗底贴缝')
  assert.equal(b.maxWidth, 984, '最宽铺满画布两侧留缝')
  assert.equal(b.maxHeight, 792 - 48, '最高从顶栏底到画布底')
  assert.equal(b.reachLeft, 992)
  assert.equal(b.reachDown, 792)
  assert.equal(b.fitWidth, 984, '没量到内容宽 = 不设上限')
  assert.equal(b.autoMaxWidth, 512, '宽度自适应档取 CSS 登记的 32rem')
  assert.equal(b.fitHeight, 744, '没量到内容高 = 不设上限')
  assert.equal(b.autoMaxHeight, 744, '高度自适应档就是画布能给的最大高')

  const home = clampPlacement(DEFAULT_PLACEMENT, b)
  assert.deepEqual(
    [home.right, home.top, home.width, home.height],
    [8, 48, null, null],
    '默认右上角'
  )

  const moved = movePlacement(home, -100, 50, b)
  assert.deepEqual([moved.right, moved.top], [108, 98], '往左下拖:right 变大、top 变大')
  const flung = movePlacement(home, -5000, 5000, b)
  assert.deepEqual([flung.right, flung.top], [b.maxRight, b.maxTop], '拖出画布外夹回范围内')
  const back = movePlacement(home, 5000, -5000, b)
  assert.deepEqual([back.right, back.top], [b.minRight, b.minTop], '拖到最右上:贴着顶栏与右缘')
}

function checkResize(): void {
  const b = sample()
  const at = clampPlacement(DEFAULT_PLACEMENT, b)
  const from = { width: 304, height: 400 }
  const wider = resizePlacement(moved(at), from, 100, 60, b)
  assert.deepEqual(
    [wider.width, wider.height, wider.right, wider.top],
    [404, 460, 8, 98],
    '往右下拉 = 变宽变高,左上角钉住(左缘贴到缝上就不再多拉)'
  )

  const huge = resizePlacement({ ...moved(at), right: 8, top: 300 }, from, 5000, 5000, b)
  assert.equal(huge.width, 304, '左缘已贴缝:再往右拉也不变宽')
  assert.equal(huge.height, 792 - 300, '拉不出画布底')
  assert.equal(huge.right, 8, '左上角不动')

  const tiny = resizePlacement(moved(at), from, -500, -500, b)
  assert.deepEqual(
    [tiny.width, tiny.height, tiny.right, tiny.top],
    [192, 96, 220, 98],
    '拉不小于最小档,左缘不动'
  )

  const tallOnly = resizePlacement(moved(at), from, 0, 30, b)
  assert.deepEqual([tallOnly.width, tallOnly.height], [null, 430], '只拉了纵向,宽度仍用默认档')
  const wideOnly = resizePlacement(moved(at), from, -40, 0, b)
  assert.deepEqual([wideOnly.width, wideOnly.height], [264, null], '只拉了横向,高度仍用默认档')
}

/** 把浮窗先挪到 (108, 98),拉伸用例都从这里起步 */
function moved(at: ReturnType<typeof clampPlacement>) {
  return { ...at, right: 108, top: 98 }
}

/**
 * 内容尺寸吸附:量到内容宽 300、高 500,自适应档宽 512。
 * 拉大松手吸回内容尺寸(左上角钉住);拉小保留;旧账比内容大就收到内容尺寸。
 */
function checkContentFit(): void {
  const b = sample(
    { width: 1000, height: 800 },
    { width: 304, height: 400 },
    { width: 300, height: 500 }
  )
  assert.equal(b.fitWidth, 300, '内容宽原样采纳')
  assert.equal(b.fitHeight, 500, '内容高原样采纳')
  assert.equal(b.autoMaxHeight, 744, '高度自适应档不受内容影响')

  const from = { width: 304, height: 400 }
  const at = movePlacement(clampPlacement(DEFAULT_PLACEMENT, b), -292, 50, b)
  assert.deepEqual([at.right, at.top], [300, 98], '先挪到画布中间再拉')

  const grown = resizePlacement(at, from, 200, 200, b)
  assert.deepEqual([grown.width, grown.height, grown.right], [504, 600, 100], '拉得比内容大')
  const settled = settleResize(grown, b)
  assert.deepEqual(
    [settled.width, settled.height, settled.right],
    [null, null, 304],
    '松手吸回内容尺寸:回自适应档(null),左缘钉住(右缘跟着收回来)'
  )

  const near = settleResize(resizePlacement(at, from, -7, 97, b), b)
  assert.deepEqual([near.width, near.height, near.right], [null, null, 304], '差几 px 也算拉满')

  const narrow = resizePlacement(at, from, -54, -100, b)
  const kept = settleResize(narrow, b)
  assert.deepEqual(
    [kept.width, kept.height, kept.right],
    [250, 300, 354],
    '比内容小的一维保留手动数,长内容走省略号,位置不跳'
  )

  const stale = capToContent({ right: 300, top: 98, width: 600, height: 600 }, b)
  assert.deepEqual(
    [stale.width, stale.height, stale.right, stale.top],
    [null, null, 300, 98],
    '旧账比当前内容大:上屏前收回内容尺寸,位置不动'
  )
  const small = capToContent({ right: 300, top: 98, width: 250, height: 400 }, b)
  assert.deepEqual([small.width, small.height], [250, 400], '比内容小的手动尺寸不动')

  const overCap = sample(
    { width: 1000, height: 800 },
    { width: 304, height: 400 },
    { width: 800, height: 5000 }
  )
  assert.equal(overCap.fitWidth, 800, '内容宽 800 超过自适应档 512')
  assert.equal(overCap.fitHeight, overCap.maxHeight, '内容高夹进画布能给的高度')
  assert.equal(
    capToContent({ right: 8, top: 48, width: 900, height: 700 }, overCap).width,
    800,
    '自适应档装不下内容宽:吸附落成手动的内容宽'
  )
  assert.equal(settleResize({ right: 8, top: 48, width: 900, height: null }, overCap).width, 800)

  const frame = snapFrame(settled, grown, b)
  assert.deepEqual(
    [frame.width, frame.height, frame.right],
    [300, 500, 304],
    '吸回动画的落点:先按内容尺寸的像素值上屏,CSS 才过渡得过去'
  )
  assert.equal(SNAP_SLACK_PX, 4, '吸附容差')
}

/** 画布缩小:存下的位置与尺寸夹回新范围,不跑出画布 */
function checkStaleRecord(): void {
  const b = sample({ width: 500, height: 400 })
  const clamped = clampPlacement({ right: 900, top: 900, width: 600, height: 600 }, b)
  assert.deepEqual(
    [clamped.right, clamped.top, clamped.width, clamped.height],
    [8, 48, 484, 344],
    '旧账的宽高先夹到画布内,位置再按夹好的尺寸收回'
  )
  assert.ok(clamped.right >= b.minRight && clamped.top >= b.minTop, '位置不越过上缘与右缘')
  assert.equal(clamped.right + clamped.width, b.reachLeft, '左缘不越界')
  assert.equal(clamped.top + clamped.height, b.reachDown, '底边不越界')
}

function node(kind: LevelNodeKind, extra: Partial<LevelNode> = {}): LevelNode {
  return { id: 'node', kind, label: 'node', degree: 0, descendantFiles: 0, ...extra }
}

/** 「显示项」的区块清单与本地账验身 */
function checkSections(): void {
  const fileSections = ['wiki', 'refs', 'dependsOn', 'usedBy', 'module', 'files', 'tests', 'styles']
  assert.deepEqual(
    graphPanelSections('file').map((s) => s.id),
    fileSections,
    '文件区块:Wiki 说明 + 关系三项 + 模块四项'
  )
  assert.deepEqual(
    graphPanelSections('folder').map((s) => s.id),
    ['contents', 'composition'],
    '文件夹:内容清单 + 模块构成'
  )

  assert.equal(parseHiddenSections(null).size, 0, '没记过 = 全显示')
  assert.equal(parseHiddenSections('refs').size, 0, '不是数组当没记过')
  assert.equal(parseHiddenSections(['nope', 42]).size, 0, '废 id 全丢掉')
  assert.deepEqual(
    [...parseHiddenSections(['refs', 'tests', 'refs'])].sort(),
    ['refs', 'tests'],
    '保留认识的 id,重复只算一次(旧版本留下的废 id 不会锁死新区块)'
  )

  assert.equal(graphPanelKindOf(node('file')), 'file', '文件')
  assert.equal(graphPanelKindOf(node('external', { target: 'file' })), 'file', '外部文件按文件列')
  assert.equal(
    graphPanelKindOf(node('external', { target: 'folder' })),
    'folder',
    '外部文件夹按文件夹列'
  )
  assert.equal(graphPanelKindOf(node('folder')), 'folder', '文件夹')
  assert.equal(graphPanelKindOf(node('overflow', { hiddenCount: 3 })), null, '收起的项没有正文')
}

/** 区块顺序账:按种类验身、拖完的可见顺序并回整单、菜单按账重排 */
function checkSectionOrder(): void {
  const defaults = parseSectionOrders(null)
  assert.deepEqual(
    defaults.file,
    ['wiki', 'refs', 'dependsOn', 'usedBy', 'module', 'files', 'tests', 'styles'],
    '没记过 = 默认顺序'
  )
  assert.deepEqual(defaults.folder, ['contents', 'composition'], '文件夹默认顺序')

  const dirty = parseSectionOrders({
    file: ['files', 'refs', 'files', 'nope', 'contents'],
    folder: 'bad'
  })
  assert.deepEqual(
    dirty.file,
    ['files', 'refs', 'wiki', 'dependsOn', 'usedBy', 'module', 'tests', 'styles'],
    '认得的去重保留,异类与未知 id 丢掉,缺的按默认补在末尾'
  )
  assert.deepEqual(dirty.folder, ['contents', 'composition'], '坏档回默认')

  assert.deepEqual(
    mergeVisibleOrder(
      ['refs', 'dependsOn', 'usedBy', 'module', 'files'],
      ['refs', 'module', 'files'],
      ['files', 'refs', 'module']
    ),
    ['files', 'dependsOn', 'usedBy', 'refs', 'module'],
    '菜单没列出的区块保持原槽位,可见子序列整体换序'
  )

  const ordered = orderGraphPanelSections('folder', {
    file: defaults.file,
    folder: ['composition', 'contents']
  })
  assert.deepEqual(
    ordered.map((s) => s.id),
    ['composition', 'contents'],
    '按记下的顺序出菜单'
  )
  assert.equal(ordered[0]?.label, '模块构成', '顺序换了,标签跟着走')

  const fileOrder = ['tests', ...defaults.file.filter((id) => id !== 'tests')]
  assert.equal(
    orderGraphPanelSections('file', { file: fileOrder, folder: defaults.folder })[0]?.id,
    'tests',
    '文件单也认自己的顺序'
  )
}

const SAMPLE_TREE: ScanDirNode = {
  type: 'directory',
  name: 'root',
  relPath: '',
  children: [
    {
      type: 'directory',
      name: 'src',
      relPath: 'src',
      children: [
        {
          type: 'directory',
          name: 'deep',
          relPath: 'src/deep',
          children: [{ type: 'file', name: 'b.ts', relPath: 'src/deep/b.ts', ext: '.ts' }]
        },
        { type: 'file', name: 'a.ts', relPath: 'src/a.ts', ext: '.ts' }
      ]
    },
    { type: 'file', name: 'README.md', relPath: 'README.md', ext: '.md' }
  ]
}

/** 文件夹内容清单:只列直接子项、文件夹在前、超长按预览额度截断 */
function checkFolderContents(): void {
  const tree = folderTree(SAMPLE_TREE)
  assert.deepEqual(
    folderContents(tree, 'src'),
    {
      entries: [
        { id: 'src/deep', name: 'deep', kind: 'folder', descendantFiles: 1 },
        { id: 'src/a.ts', name: 'a.ts', kind: 'file', descendantFiles: 0 }
      ],
      hidden: 0
    },
    '只列直接子项,文件夹在前,不递归'
  )
  assert.deepEqual(folderContents(tree, 'missing'), { entries: [], hidden: 0 }, '不在树里 = 空')
  assert.deepEqual(
    folderContents(tree, '').entries.map((entry) => entry.name),
    ['src', 'README.md'],
    '根目录也只列直接子项'
  )
  assert.equal(folderContents(tree, '').entries[0]?.descendantFiles, 2, '文件夹带后代文件数')
  const wide: ScanDirNode = {
    type: 'directory',
    name: 'wide',
    relPath: '',
    children: Array.from({ length: GRAPH_PREVIEW_NODES + 3 }, (_, i) => ({
      type: 'file',
      name: `f${i}.ts`,
      relPath: `f${i}.ts`,
      ext: '.ts'
    }))
  }
  const capped = folderContents(folderTree(wide), '')
  assert.equal(capped.entries.length, GRAPH_PREVIEW_NODES, '按预览额度截断')
  assert.equal(capped.hidden, 3, '其余项数单独给出')
}

const MODULE_MAP: ModuleMap = {
  algorithmVersion: 1,
  params: DEFAULT_MODULE_PARAMS,
  modules: [
    {
      id: 'm:src/a.ts',
      anchor: 'src/a.ts',
      folder: 'src',
      files: ['src/a.ts', 'src/a.css', 'src/a.test.ts', 'src/b.ts'],
      attached: ['src/a.css'],
      tests: ['src/a.test.ts'],
      folders: ['src']
    },
    {
      id: 'm:lib/c.ts',
      anchor: 'lib/c.ts',
      folder: 'lib',
      files: ['lib/c.ts'],
      attached: [],
      tests: [],
      folders: ['lib']
    }
  ],
  fileToModule: {
    'src/a.ts': 'm:src/a.ts',
    'src/a.css': 'm:src/a.ts',
    'src/a.test.ts': 'm:src/a.ts',
    'src/b.ts': 'm:src/a.ts',
    'lib/c.ts': 'm:lib/c.ts'
  },
  links: [
    { from: 'm:src/a.ts', to: 'm:lib/c.ts', weight: 2 },
    { from: 'm:lib/c.ts', to: 'm:src/a.ts', weight: 1 }
  ]
}

const DEP_NODES = new Map<string, DepGraphNode>([
  ['src/a.ts', { relPath: 'src/a.ts', languageId: 'typescript', inCount: 1, outCount: 2 }]
])

/** 「显示项」只列当前节点真有内容的区块:未归类文件不摆一堆空开关 */
function checkAvailability(): void {
  const tree = folderTree(SAMPLE_TREE)
  const available = (
    id: string,
    kind: LevelNodeKind = 'file',
    modules: ModuleMap | null = MODULE_MAP,
    wiki: {
      wikiPage?: WikiPanelPage | null
      wikiGroup?: string | null
      wikiDamaged?: boolean
    } = {}
  ) =>
    [
      ...availableGraphPanelSections({
        node: node(kind, { id }),
        modules,
        depNodes: DEP_NODES,
        tree,
        ...wiki
      })
    ].sort()

  assert.deepEqual(
    available('src/a.ts'),
    ['dependsOn', 'files', 'module', 'refs', 'styles', 'tests', 'usedBy'],
    '归类的文件:引用、模块、文件、自测、样式与两条模块连线都真有内容'
  )
  assert.deepEqual(
    available('lib/c.ts'),
    ['dependsOn', 'files', 'module', 'usedBy'],
    '没有引用记录的文件不摆引用关系,没有自测/样式也不摆'
  )
  assert.deepEqual(available('CHANGELOG.md'), [], '未归类的根目录文件没有任何区块可显示')
  assert.deepEqual(available('src/a.ts', 'file', null), ['refs'], '模块划分不可用时只剩引用关系')

  const donePage: WikiPanelPage = {
    pageId: 'm:src/a.ts',
    kind: 'module',
    status: 'done',
    name: '文件来源',
    summary: '一句话',
    tags: ['文件'],
    keyFiles: ['src/a.ts'],
    excerpt: '摘要',
    file: '模块/文件来源.md',
    generatedAt: '2026-11-01T10:00:00.000Z',
    model: 'qwen'
  }
  assert.ok(
    available('src/a.ts', 'file', MODULE_MAP, { wikiPage: donePage }).includes('wiki'),
    '有 Wiki 说明就摆这一块'
  )
  assert.ok(
    !available('src/a.ts', 'file', MODULE_MAP, {
      wikiPage: { ...donePage, status: 'none' }
    }).includes('wiki'),
    '记账里没有这页 = 不摆空区块'
  )
  assert.ok(
    available('CHANGELOG.md', 'file', MODULE_MAP, { wikiGroup: '根目录散件' }).includes('wiki'),
    '散件还没生成也能看到所属组'
  )
  assert.ok(
    !available('lib/c.ts', 'file', MODULE_MAP, { wikiGroup: null }).includes('wiki'),
    '模块文件没有散件组归属'
  )
  assert.ok(
    available('lib/c.ts', 'file', MODULE_MAP, { wikiDamaged: true }).includes('wiki'),
    '记账损坏也要留一行提示'
  )

  assert.deepEqual(
    available('src', 'folder'),
    ['composition', 'contents'],
    '有后代模块的文件夹两块都列'
  )
  assert.deepEqual(available('lib', 'folder'), ['composition'], '不在扫描树里的文件夹只列模块构成')
  assert.deepEqual(available('docs', 'folder'), [], '树里没有、模块也没有的文件夹不给空菜单')
  assert.deepEqual(available('overflow', 'overflow'), [], '收起的项没有正文')
}

/** 模块名:有 AI 名称用 AI 的,没有回退程序名,重名各自缀上程序名 */
function checkModuleNames(): void {
  const modules: ModuleInfo[] = [
    {
      id: 'm:a',
      anchor: 'src/a.ts',
      folder: 'src',
      files: [],
      attached: [],
      tests: [],
      folders: []
    },
    {
      id: 'm:b',
      anchor: 'src/b.ts',
      folder: 'src',
      files: [],
      attached: [],
      tests: [],
      folders: []
    },
    {
      id: 'm:c',
      anchor: 'src/c.ts',
      folder: 'src',
      files: [],
      attached: [],
      tests: [],
      folders: []
    }
  ]
  const names = moduleNamesOf(modules, (id) => (id === 'm:a' || id === 'm:b' ? '同名模块' : null))
  assert.equal(names.get('m:a'), '同名模块 · src · a.ts', '两条 AI 名称撞车时缀上程序名')
  assert.equal(names.get('m:b'), '同名模块 · src · b.ts')
  assert.equal(names.get('m:c'), 'src · c.ts', '没有 AI 名称回退程序名')

  const single = moduleNamesOf([modules[0]], () => '独立名称')
  assert.equal(single.get('m:a'), '独立名称', '名字唯一时直接显示 AI 名称')
  assert.equal(moduleNamesOf([], () => 'x').size, 0, '没有模块就没有名字')
}

checkBounds()
checkResize()
checkContentFit()
checkStaleRecord()
checkSections()
checkSectionOrder()
checkFolderContents()
checkAvailability()
checkModuleNames()
console.log('✅ 图谱详情浮窗自测全部通过')
console.log(
  '   活动范围(顶栏让位/四边缝/默认右上角) · 拖动夹边 · 右下角拉伸(左上角钉住/最小宽高/拉不出画布) · 内容尺寸吸附(拉大吸回/拉小保留/旧账收窄) · 画布缩小后旧账夹回 · 显示项区块清单与本地账验身 · 显示项拖动排序(顺序账验身/可见序并回整单) · 文件夹内容清单(直接子项/截断) · 显示项可用性过滤 · 模块 AI 名称与重名回退'
)
