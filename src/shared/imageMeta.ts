// ── 图片字节验身(纯函数,自测覆盖)──
// 预览图片不靠后缀认亲:PNG/JPEG 各看魔数,魔数对了再从文件头量宽高。
// 宽高读不出(文件被截断、头部畸形)不报错 —— 留 null 让界面少说,
// 不许拿 0 冒充尺寸。

/** 预览认得的图片 MIME(与 IMAGE_EXTS 一一对应) */
export type ImageMime = 'image/png' | 'image/jpeg'

export interface ImageMeta {
  mime: ImageMime
  /** 像素宽;读不出 = null(魔数已对,但头部不完整) */
  width: number | null
  /** 像素高;同上 */
  height: number | null
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function matchAt(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  if (offset + expected.length > bytes.length) return false
  return expected.every((b, i) => bytes[offset + i] === b)
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  )
}

/** PNG:签名 8 字节对了就认;IHDR 完整才量得出宽高(签名 8B + 长度 4B + 'IHDR' 4B + 宽高各 4B) */
function sniffPng(bytes: Uint8Array): ImageMeta | null {
  if (!matchAt(bytes, 0, PNG_SIGNATURE)) return null
  const IHDR = [0x49, 0x48, 0x44, 0x52]
  if (bytes.length >= 24 && matchAt(bytes, 12, IHDR)) {
    return { mime: 'image/png', width: u32be(bytes, 16), height: u32be(bytes, 20) }
  }
  return { mime: 'image/png', width: null, height: null }
}

/**
 * JPEG:认 FF D8 FF 开头,然后顺段走 —— 每段 [FF 标记][长度][数据],
 * 量到 SOF0/SOF1/SOF2 段里的高宽就停;扫完没碰到 SOF 也认是 JPEG,宽高留 null。
 * SOI/EOI/RST 这类无数据的单字节标记没有长度字段,按定长跳。
 */
function sniffJpeg(bytes: Uint8Array): ImageMeta | null {
  if (!matchAt(bytes, 0, [0xff, 0xd8, 0xff])) return null
  const SOF = new Set([0xc0, 0xc1, 0xc2])
  let pos = 2 // 跳过 FF D8,从第一个段标记开始走
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) return { mime: 'image/jpeg', width: null, height: null }
    const marker = bytes[pos + 1]
    if (SOF.has(marker)) {
      // SOF 段:长度 2B + 精度 1B + 高 2B + 宽 2B
      if (pos + 8 < bytes.length) {
        return {
          mime: 'image/jpeg',
          width: u16be(bytes, pos + 7),
          height: u16be(bytes, pos + 5)
        }
      }
      return { mime: 'image/jpeg', width: null, height: null }
    }
    // 无长度字段的标记(SOI/EOI/RST/TEM)按 2 字节跳;FF D9(EOI)/FF DA(SOS)之后没有尺寸可量
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      if (marker === 0xd9 || marker === 0xd8) {
        return { mime: 'image/jpeg', width: null, height: null }
      }
      pos += 2
      continue
    }
    if (pos + 3 >= bytes.length) return { mime: 'image/jpeg', width: null, height: null }
    const len = u16be(bytes, pos + 2)
    if (len < 2) return { mime: 'image/jpeg', width: null, height: null }
    pos += 2 + len
  }
  return { mime: 'image/jpeg', width: null, height: null }
}

/**
 * 给一段字节验身:认出 PNG/JPEG 回元信息;魔数对不上(不是图/是别的二进制)回 null。
 * 只要魔数对,哪怕文件被拦腰截断、量不出宽高,也如实回 mime + null 尺寸。
 */
export function sniffImage(bytes: Uint8Array): ImageMeta | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes)
}
