// 图片字节验身(纯函数,自测覆盖)
// 预览图片不靠后缀认亲:PNG/JPEG 各看魔数,魔数对了再从文件头量宽高、色深、透明、渐进式。
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
  /** 每个通道的位数;读不出 = null */
  bitDepth: number | null
  /** 是否带透明通道;读不出 = null。JPEG 无透明,认出来就是 false */
  transparent: boolean | null
  /** JPEG 是否渐进式;PNG 或尚未扫到 SOF = null */
  progressive: boolean | null
}

export interface ImageInfoFact {
  label: string
  value: string
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_ALPHA = new Set([4, 6])

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

function pngUnknown(): ImageMeta {
  return {
    mime: 'image/png',
    width: null,
    height: null,
    bitDepth: null,
    transparent: null,
    progressive: null
  }
}

function jpegUnknown(): ImageMeta {
  return {
    mime: 'image/jpeg',
    width: null,
    height: null,
    bitDepth: null,
    transparent: false,
    progressive: null
  }
}

/** 从 IHDR 之后扫 tRNS 段:调色板/灰阶/真彩都可以靠它声明透明 */
function pngHasTrns(bytes: Uint8Array): boolean {
  let pos = 8
  while (pos + 12 <= bytes.length) {
    const len = u32be(bytes, pos)
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    if (type === 'tRNS') return true
    if (type === 'IDAT' || type === 'IEND') return false
    const next = pos + 12 + len
    if (next <= pos) return false
    pos = next
  }
  return false
}

/** PNG:签名 8 字节对了就认;IHDR 完整才量得出宽高与色深 */
function sniffPng(bytes: Uint8Array): ImageMeta | null {
  if (!matchAt(bytes, 0, PNG_SIGNATURE)) return null
  const IHDR = [0x49, 0x48, 0x44, 0x52]
  if (bytes.length < 24 || !matchAt(bytes, 12, IHDR)) return pngUnknown()
  const width = u32be(bytes, 16)
  const height = u32be(bytes, 20)
  if (bytes.length < 26) {
    return { ...pngUnknown(), width, height }
  }
  const bitDepth = bytes[24]
  const colorType = bytes[25]
  const transparent = PNG_ALPHA.has(colorType) || pngHasTrns(bytes)
  return {
    mime: 'image/png',
    width,
    height,
    bitDepth,
    transparent,
    progressive: null
  }
}

/**
 * JPEG:认 FF D8 FF 开头,然后顺段走 —— 每段 [FF 标记][长度][数据],
 * 量到 SOF0/SOF1/SOF2 段里的高宽就停;SOF2 为渐进式。
 * SOI/EOI/RST 这类无数据的单字节标记没有长度字段,按定长跳。
 */
function sniffJpeg(bytes: Uint8Array): ImageMeta | null {
  if (!matchAt(bytes, 0, [0xff, 0xd8, 0xff])) return null
  const SOF = new Set([0xc0, 0xc1, 0xc2])
  let pos = 2
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) return jpegUnknown()
    const marker = bytes[pos + 1]
    if (SOF.has(marker)) {
      if (pos + 8 >= bytes.length) return jpegUnknown()
      return {
        mime: 'image/jpeg',
        width: u16be(bytes, pos + 7),
        height: u16be(bytes, pos + 5),
        bitDepth: bytes[pos + 4],
        transparent: false,
        progressive: marker === 0xc2
      }
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      if (marker === 0xd9 || marker === 0xd8) return jpegUnknown()
      pos += 2
      continue
    }
    if (pos + 3 >= bytes.length) return jpegUnknown()
    const len = u16be(bytes, pos + 2)
    if (len < 2) return jpegUnknown()
    pos += 2 + len
  }
  return jpegUnknown()
}

/**
 * 给一段字节验身:认出 PNG/JPEG 回元信息;魔数对不上(不是图/是别的二进制)回 null。
 * 只要魔数对,哪怕文件被拦腰截断、量不出宽高,也如实回 mime + null 尺寸。
 */
export function sniffImage(bytes: Uint8Array): ImageMeta | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes)
}

/** 底栏按住面板用的人话条目:读得出才报,读不出的字段不占行 */
export function imageInfoFacts(meta: ImageMeta): ImageInfoFact[] {
  const rows: ImageInfoFact[] = [
    { label: '格式', value: meta.mime === 'image/png' ? 'PNG' : 'JPEG' }
  ]
  if (meta.bitDepth !== null) rows.push({ label: '色深', value: `${meta.bitDepth} 位` })
  if (meta.transparent !== null) rows.push({ label: '透明', value: meta.transparent ? '有' : '无' })
  if (meta.progressive !== null)
    rows.push({ label: '渐进式', value: meta.progressive ? '是' : '否' })
  return rows
}
