// .uiframe 方案文件(第 15 节):zip 容器,内部 manifest.json + design.json + assets/icons/ + thumbnail.png。
// 打包/解包是纯函数层:主进程负责选路径与读写,渲染层只拿字符串;格式版本号在 manifest 里(见 scheme.ts)。
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { SCHEME_FORMAT_VERSION } from './scheme.ts'

export const UIFRAME_EXT = '.uiframe'

/** 包内固定成员名;图标目录先占位(M3-e 自定义 SVG 落地后往里面放文件) */
const ENTRY_MANIFEST = 'manifest.json'
const ENTRY_DESIGN = 'design.json'
const ENTRY_THUMB = 'thumbnail.png'
const ENTRY_ICON_DIR = 'assets/icons/'

export interface UiframePackInput {
  /** manifest.json 原文(JSON 字符串) */
  manifest: string
  /** design.json 原文(JSON 字符串) */
  design: string
  /** 缩略图 PNG 字节;没有就省掉这条成员 */
  thumbnail?: Uint8Array | null
  /** assets/icons/ 下的自定义图标文件:文件名 → 原始字节(M3-e 用) */
  icons?: Record<string, Uint8Array>
}

export interface UiframeContents {
  manifest: string | null
  design: string
  thumbnail: Uint8Array | null
  /** assets/icons/ 下解出的图标文件:文件名 → 原始字节 */
  icons: Record<string, Uint8Array>
}

/** 打包成 .uiframe zip 字节;manifest 里必须带当前格式版本号 */
export function packUiframe(input: UiframePackInput): Uint8Array {
  const manifest = JSON.parse(input.manifest) as Record<string, unknown>
  if (manifest['formatVersion'] !== SCHEME_FORMAT_VERSION) {
    throw new Error(`manifest 格式版本不对:${String(manifest['formatVersion'])}`)
  }
  const entries: Record<string, Uint8Array> = {
    [ENTRY_MANIFEST]: strToU8(input.manifest),
    [ENTRY_DESIGN]: strToU8(input.design)
  }
  if (input.thumbnail) entries[ENTRY_THUMB] = input.thumbnail
  for (const [name, bytes] of Object.entries(input.icons ?? {})) {
    entries[`${ENTRY_ICON_DIR}${name}`] = bytes
  }
  return zipSync(entries, { level: 6 })
}

/** 解包 .uiframe:先验 manifest 版本再取 design;缺 design 或非 zip 一律报错 */
export function unpackUiframe(bytes: Uint8Array): UiframeContents {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new Error('不是有效的方案文件(.uiframe 本质是 zip)')
  }
  const rawManifest = files[ENTRY_MANIFEST]
  const manifest = rawManifest ? strFromU8(rawManifest) : null
  if (manifest !== null) {
    const parsed = JSON.parse(manifest) as Record<string, unknown>
    if (parsed['formatVersion'] !== SCHEME_FORMAT_VERSION) {
      throw new Error(`方案文件格式版本不支持:${String(parsed['formatVersion'])}`)
    }
  }
  const rawDesign = files[ENTRY_DESIGN]
  if (!rawDesign) throw new Error('方案文件里缺 design.json')
  const icons: Record<string, Uint8Array> = {}
  for (const [name, bytes] of Object.entries(files)) {
    if (name.startsWith(ENTRY_ICON_DIR) && name.length > ENTRY_ICON_DIR.length) {
      icons[name.slice(ENTRY_ICON_DIR.length)] = bytes
    }
  }
  return {
    manifest,
    design: strFromU8(rawDesign),
    thumbnail: files[ENTRY_THUMB] ?? null,
    icons
  }
}
