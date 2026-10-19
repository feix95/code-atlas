// 图片预览视口纯计算:适应窗口、100%、对准某点缩放、平移夹紧、滚轮倍率。
import assert from 'node:assert/strict'
import {
  IMAGE_FIT_INSET,
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  IMAGE_ZOOM_PRESETS,
  actualImageView,
  canPanImage,
  clampImagePan,
  clampImageZoom,
  fitImageView,
  imageWheelFactor,
  panImage,
  parseImageZoomPercent,
  zoomImageAt
} from '../src/shared/imageZoom.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`  ✓ ${name}`)
}

function main(): void {
  check('非法倍率回 100%;超上下限贴边', () => {
    assert.equal(clampImageZoom(Number.NaN), 1)
    assert.equal(clampImageZoom(0), 1)
    assert.equal(clampImageZoom(-2), 1)
    assert.equal(clampImageZoom(0.01), IMAGE_ZOOM_MIN)
    assert.equal(clampImageZoom(100), IMAGE_ZOOM_MAX)
    assert.equal(clampImageZoom(1.5), 1.5)
  })

  check('适应窗口:小图不放大且居中', () => {
    const view = fitImageView({ width: 200, height: 100 }, { width: 800, height: 600 })
    assert.equal(view.zoom, 1)
    assert.equal(view.panX, (800 - 200) / 2)
    assert.equal(view.panY, (600 - 100) / 2)
    assert.equal(canPanImage(view, { width: 200, height: 100 }, { width: 800, height: 600 }), false)
  })

  check('适应窗口:大图缩进留白且不超过 100%', () => {
    const natural = { width: 4000, height: 3000 }
    const viewport = { width: 800, height: 600 }
    const view = fitImageView(natural, viewport)
    assert.ok(view.zoom < 1)
    assert.ok(4000 * view.zoom <= 800 - IMAGE_FIT_INSET * 2 + 1e-9)
    assert.ok(3000 * view.zoom <= 600 - IMAGE_FIT_INSET * 2 + 1e-9)
    assert.ok(view.zoom <= 1)
    assert.equal(canPanImage(view, natural, viewport), false)
  })

  check('100% 原尺寸:小图居中;大图停在可平移范围中点', () => {
    const small = actualImageView({ width: 200, height: 100 }, { width: 800, height: 600 })
    assert.equal(small.zoom, 1)
    assert.equal(small.panX, (800 - 200) / 2)
    const natural = { width: 4000, height: 3000 }
    const viewport = { width: 800, height: 600 }
    const big = actualImageView(natural, viewport)
    assert.equal(big.zoom, 1)
    assert.equal(big.panX, (800 - 4000) / 2)
    assert.equal(big.panY, (600 - 3000) / 2)
    assert.equal(canPanImage(big, natural, viewport), true)
  })

  check('以屏幕点为中心缩放:该点下的图片像素不动', () => {
    const view = { zoom: 1, panX: 100, panY: 50 }
    const next = zoomImageAt(view, 2, 300, 250)
    const imgX = (300 - view.panX) / view.zoom
    const imgY = (250 - view.panY) / view.zoom
    assert.equal(next.panX + imgX * next.zoom, 300)
    assert.equal(next.panY + imgY * next.zoom, 250)
    assert.equal(zoomImageAt(view, 1000, 0, 0).zoom, IMAGE_ZOOM_MAX)
    assert.equal(zoomImageAt(view, 0.001, 0, 0).zoom, IMAGE_ZOOM_MIN)
  })

  check('平移后再夹紧:小图仍居中;大图不露底', () => {
    const small = clampImagePan(
      panImage({ zoom: 1, panX: 10, panY: 10 }, 50, 50),
      { width: 200, height: 100 },
      { width: 800, height: 600 }
    )
    assert.equal(small.panX, (800 - 200) / 2)
    assert.equal(small.panY, (600 - 100) / 2)
    const natural = { width: 4000, height: 3000 }
    const viewport = { width: 800, height: 600 }
    const overflow = clampImagePan({ zoom: 1, panX: 50, panY: 50 }, natural, viewport)
    assert.equal(overflow.panX, 0)
    assert.equal(overflow.panY, 0)
    const under = clampImagePan({ zoom: 1, panX: -99999, panY: -99999 }, natural, viewport)
    assert.equal(under.panX, 800 - 4000)
    assert.equal(under.panY, 600 - 3000)
  })

  check('向下滚缩小、向上滚放大', () => {
    assert.ok(imageWheelFactor(100, 0) < 1)
    assert.ok(imageWheelFactor(-100, 0) > 1)
  })

  check('底栏档位是 25 一档的六档', () => {
    assert.deepEqual([...IMAGE_ZOOM_PRESETS], [150, 125, 100, 75, 50, 25])
  })

  check('解析输入百分比:带%、夹边、垃圾回 null', () => {
    assert.equal(parseImageZoomPercent('150'), 150)
    assert.equal(parseImageZoomPercent(' 75% '), 75)
    assert.equal(parseImageZoomPercent('9999'), 800)
    assert.equal(parseImageZoomPercent('1'), 5)
    assert.equal(parseImageZoomPercent(''), null)
    assert.equal(parseImageZoomPercent('0'), null)
    assert.equal(parseImageZoomPercent('abc'), null)
  })

  console.log('✅ 图片预览视口自测全部通过')
}

main()
