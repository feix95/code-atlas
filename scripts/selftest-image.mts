// 图片预览的自测:后缀名单、魔数验身、宽高量取、分支判定 ——
// 后缀可以改名冒充,字节不会撒谎,每条岔路都得钉死在账上。
// 样本字节全在内存里构造,仓库里不放任何二进制图片。
import assert from 'node:assert/strict'
import { IMAGE_EXTS, isImageFile, imageMimeOf, canPreviewFile } from '../src/shared/fileKinds.ts'
import { imageInfoFacts, sniffImage } from '../src/shared/imageMeta.ts'
import { imageResultFromBytes, readImagePreview } from '../src/main/imagePreview.ts'
import { IMAGE_PREVIEW_MAX_BYTES } from '../src/shared/preview.ts'

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** 造一张内存里的最小 PNG:签名 + IHDR 段头(宽 2 × 高 3);colorType 默认 6=RGBA */
function pngBytes(width: number, height: number, colorType = 6): Uint8Array {
  return new Uint8Array([
    ...PNG_SIG,
    0x00,
    0x00,
    0x00,
    0x0d, // IHDR 段长 13
    0x49,
    0x48,
    0x44,
    0x52, // 'IHDR'
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
    0x08,
    colorType,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00
  ])
}

/** 造一段内存里的最小 JPEG:SOI + APP0 + SOF(默认 SOF0 基线) + EOI */
function jpegBytes(width: number, height: number, sof = 0xc0): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10, // APP0 段,长度 16(含长度字段自身 2 字节)
    ...new Array(14).fill(0x00),
    0xff,
    sof,
    0x00,
    0x11, // 段长 17
    0x08, // 精度
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    ...new Array(9).fill(0x00),
    0xff,
    0xd9
  ])
}

async function main(): Promise<void> {
  // 1. 图片名单(IMAGE_EXTS 是唯一名单):png/jpg/jpeg 三种,别的图片格式暂不认
  assert.deepEqual([...IMAGE_EXTS].sort(), ['.jpeg', '.jpg', '.png'], '名单就这三种')
  assert.equal(isImageFile('a.png'), true, 'png 是图片')
  assert.equal(isImageFile('B.JPG'), true, '大写后缀也算')
  assert.equal(isImageFile('c.jpeg'), true, 'jpeg 是图片')
  assert.equal(isImageFile('d.gif'), false, 'gif 不在预览名单,仍走二进制')
  assert.equal(isImageFile('noext'), false, '没后缀不算')
  assert.equal(isImageFile('.png'), false, '隐藏文件式的名字不算(没有主名)')
  assert.equal(canPreviewFile('a.ts'), true, '源码能开预览签')
  assert.equal(canPreviewFile('a.png'), true, 'png 能开预览签')
  assert.equal(canPreviewFile('logo.svg'), true, 'svg 当文本预览')
  assert.equal(canPreviewFile('Makefile'), true, '无后缀当文本预览')
  assert.equal(canPreviewFile('shot.psd'), false, 'psd 不开预览签')
  assert.equal(canPreviewFile('a.pdf'), false, 'pdf 不开预览签')
  assert.equal(canPreviewFile('a.gif'), false, 'gif 不开预览签')

  // 2. 后缀 → MIME:名单外的后缀回 null,不许冒充
  assert.equal(imageMimeOf('a.png'), 'image/png', 'png → image/png')
  assert.equal(imageMimeOf('a.jpg'), 'image/jpeg', 'jpg → image/jpeg')
  assert.equal(imageMimeOf('a.JPEG'), 'image/jpeg', '大写 jpeg 也认')
  assert.equal(imageMimeOf('a.gif'), null, 'gif 没有 MIME 可报')
  assert.equal(imageMimeOf('a.txt'), null, '文本后缀回 null')

  // 3. sniffImage·PNG:魔数认亲,IHDR 量宽高
  const png = pngBytes(2, 3)
  assert.deepEqual(
    sniffImage(png),
    {
      mime: 'image/png',
      width: 2,
      height: 3,
      bitDepth: 8,
      transparent: true,
      progressive: null
    },
    'PNG 魔数对、IHDR 量出宽高;RGBA 报有透明'
  )
  const rgb = pngBytes(2, 3, 2)
  assert.equal(sniffImage(rgb)?.transparent, false, '真彩无 tRNS 不算透明')
  // 只剩签名(后面被截断):认得出是 PNG,但宽高读不出 → null,不拿 0 冒充
  assert.deepEqual(
    sniffImage(new Uint8Array(PNG_SIG)),
    {
      mime: 'image/png',
      width: null,
      height: null,
      bitDepth: null,
      transparent: null,
      progressive: null
    },
    'PNG 只剩签名:宽高 null 不报错'
  )
  // 签名对但 IHDR 段头也被截了(短于 24 字节)
  assert.deepEqual(
    sniffImage(png.slice(0, 20)),
    {
      mime: 'image/png',
      width: null,
      height: null,
      bitDepth: null,
      transparent: null,
      progressive: null
    },
    'PNG 截在 IHDR 中间:宽高 null'
  )

  // 4. sniffImage·JPEG:认 FF D8 FF,扫段量 SOF
  const jpeg = jpegBytes(64, 32)
  assert.deepEqual(
    sniffImage(jpeg),
    {
      mime: 'image/jpeg',
      width: 64,
      height: 32,
      bitDepth: 8,
      transparent: false,
      progressive: false
    },
    'JPEG 扫到 SOF0 量出宽高;基线非渐进、无透明'
  )
  const progressive = jpegBytes(64, 32, 0xc2)
  assert.equal(sniffImage(progressive)?.progressive, true, 'SOF2 报渐进式')
  // 没有 SOF 段的 JPEG(SOI+APP0+EOI):魔数对,宽高 null
  const noSof = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    ...new Array(14).fill(0x00),
    0xff,
    0xd9
  ])
  assert.deepEqual(
    sniffImage(noSof),
    {
      mime: 'image/jpeg',
      width: null,
      height: null,
      bitDepth: null,
      transparent: false,
      progressive: null
    },
    'JPEG 没扫到 SOF:宽高 null'
  )

  // 5. 假冒与残缺:魔数对不上就是不是图
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50])), null, 'PNG 签名不全不算图')
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8])), null, 'FF D8 两字节不算 JPEG')
  assert.equal(sniffImage(new TextEncoder().encode('这不是图片,是文字')), null, '文本字节不是图')
  assert.equal(sniffImage(new Uint8Array([])), null, '空数据不是图')
  assert.equal(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38])), null, 'GIF 魔数不认')

  // 6. 分支判定(图片支路的纯逻辑):真图回 image、假冒回 binary
  const ok = imageResultFromBytes('a.png', png)
  assert.equal(ok.status, 'image', '真 PNG 回 image')
  assert.equal(ok.image?.mime, 'image/png', 'MIME 跟字节走')
  assert.equal(ok.image?.width, 2, '宽带上')
  assert.equal(ok.image?.height, 3, '高带上')
  assert.equal(ok.image?.bytes, png.byteLength, '体积报实数')
  assert.equal(ok.image?.bitDepth, 8, '色深带上')
  assert.equal(ok.image?.transparent, true, 'RGBA 透明带上')
  assert.equal(ok.image?.progressive, null, 'PNG 没有渐进式字段')
  assert.ok(ok.image?.dataUrl.startsWith('data:image/png;base64,'), 'dataUrl 是 base64 的 png')
  // base64 解回去的字节必须与原样一致(dataUrl 不撒谎)
  const b64 = ok.image!.dataUrl.slice('data:image/png;base64,'.length)
  assert.deepEqual(Buffer.from(b64, 'base64'), Buffer.from(png), 'dataUrl 解回去还是同一份字节')

  const jpg = imageResultFromBytes('b.jpg', jpeg)
  assert.equal(jpg.status, 'image', '真 JPEG 回 image')
  assert.equal(jpg.image?.mime, 'image/jpeg', 'JPEG 的 MIME')
  assert.equal(jpg.image?.width, 64, 'JPEG 宽')
  assert.equal(jpg.image?.progressive, false, '基线 JPEG 不是渐进式')
  assert.deepEqual(
    imageInfoFacts(sniffImage(png)!),
    [
      { label: '格式', value: 'PNG' },
      { label: '色深', value: '8 位' },
      { label: '透明', value: '有' }
    ],
    'PNG 面板条目'
  )
  assert.deepEqual(
    imageInfoFacts(sniffImage(jpeg)!),
    [
      { label: '格式', value: 'JPEG' },
      { label: '色深', value: '8 位' },
      { label: '透明', value: '无' },
      { label: '渐进式', value: '否' }
    ],
    'JPEG 面板条目'
  )

  // 改名冒充:后缀是 .png,内容是文本 → binary,理由说人话
  const fake = imageResultFromBytes('fake.png', new TextEncoder().encode('我是文本'))
  assert.equal(fake.status, 'binary', '假冒图片回 binary')
  assert.ok(fake.reason.includes('后缀是图片'), '理由点出「后缀是图片但内容不是」')
  assert.equal(fake.image, undefined, 'binary 不带图片账')

  // 后缀标错但内容是真图(.png 里装 JPEG):dataUrl 跟字节说实话,不冤枉它
  const mislabeled = imageResultFromBytes('wrong.png', jpeg)
  assert.equal(mislabeled.status, 'image', '后缀标错的真图照样看')
  assert.equal(mislabeled.image?.mime, 'image/jpeg', 'MIME 按字节报,不按后缀报')

  // 7. 拒绝路径:超线的图片在进 readImagePreview 时被 too-big 挡回(不碰盘)
  const tooBig = await readImagePreview({
    absPath: 'E:/这条路根本不存在/不会真去读.png',
    relPath: 'huge.png',
    sizeBytes: IMAGE_PREVIEW_MAX_BYTES + 1
  })
  assert.equal(tooBig.status, 'too-big', '超线图片回 too-big')
  assert.ok(tooBig.reason.includes('太大'), '理由说人话')

  console.log('✅ 图片预览自测全部通过')
  console.log(
    '   图片名单 · 后缀→MIME · PNG 验身(完整/截断) · JPEG 扫段(SOF/无 SOF) · 假冒与空数据 · image/binary/too-big 三分支 · dataUrl 往返一致'
  )
}

await main()
