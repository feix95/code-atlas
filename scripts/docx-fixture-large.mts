// 大 Word 样本工厂(只在测试时现造,落到临时目录,绝不进仓库):满是截图的学习笔记长什么样,
// 这里就造什么样 —— 每张图是一块随机噪点 PNG(压不动,文件体积≈图片体积),隔几张插一个标题。
import { randomBytes } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
import { buildDocx, docxXml } from './docx-fixture.mts'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** 真彩色(RGB)、8 位 */
const PNG_COLOR_RGB = 2
const PNG_BIT_DEPTH = 8
const RGB_BYTES = 3
/** 每隔几张图插一个二级标题,大纲才有东西可列 */
const IMAGES_PER_SECTION = 5

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

/** 一张 width×height 的随机噪点 PNG(不压缩的 deflate 块,体积约 width*height*3) */
export function noisePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = PNG_BIT_DEPTH
  ihdr[9] = PNG_COLOR_RGB
  const row = width * RGB_BYTES + 1
  const raw = randomBytes(row * height)
  for (let y = 0; y < height; y++) raw[y * row] = 0
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 0 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

export interface HeavyDocxSpec {
  images: number
  width: number
  height: number
}

/** 满是截图的长文档:标题 + 说明段 + 图片,图片字节各不相同 */
export function buildImageHeavyDocx(spec: HeavyDocxSpec): Buffer {
  const body: string[] = [docxXml.heading('Study notes')]
  const images: Record<string, string> = {}
  const imageData: Record<string, Uint8Array> = {}
  for (let i = 0; i < spec.images; i++) {
    if (i % IMAGES_PER_SECTION === 0) {
      body.push(docxXml.heading(`Chapter ${i / IMAGES_PER_SECTION + 1}`, 'Heading2'))
    }
    const rel = `rIdShot${i}`
    const file = `shot${i}.png`
    body.push(docxXml.para(`Screenshot ${i + 1}`), docxXml.image(rel))
    images[rel] = file
    imageData[file] = noisePng(spec.width, spec.height)
  }
  return buildDocx({ body, images, imageData })
}
