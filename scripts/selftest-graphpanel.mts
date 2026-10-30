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

/** 画布 1000x800,顶栏让出 48,缝 8,浮窗 304x400,最小 192x96,自适应档宽 384(24rem) */
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
    autoMaxWidth: 384
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
  assert.equal(b.autoMaxWidth, 384, '宽度自适应档取 CSS 登记的 24rem')
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
 * 内容尺寸吸附:量到内容宽 300、高 500,自适应档宽 384。
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
    { width: 500, height: 5000 }
  )
  assert.equal(overCap.fitWidth, 500, '内容宽 500 超过自适应档 384')
  assert.equal(overCap.fitHeight, overCap.maxHeight, '内容高夹进画布能给的高度')
  assert.equal(
    capToContent({ right: 8, top: 48, width: 700, height: 700 }, overCap).width,
    500,
    '自适应档装不下内容宽:吸附落成手动的内容宽'
  )
  assert.equal(settleResize({ right: 8, top: 48, width: 500, height: null }, overCap).width, 500)

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

checkBounds()
checkResize()
checkContentFit()
checkStaleRecord()
console.log('✅ 图谱详情浮窗自测全部通过')
console.log(
  '   活动范围(顶栏让位/四边缝/默认右上角) · 拖动夹边 · 右下角拉伸(左上角钉住/最小宽高/拉不出画布) · 内容尺寸吸附(拉大吸回/拉小保留/旧账收窄) · 画布缩小后旧账夹回'
)
