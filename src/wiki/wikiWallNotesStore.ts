// 线索桌便签与图片的落盘:放在 Wiki 项目目录下的 .codeatlas-wall,不进代码仓库,清理 Wiki 也不碰它。
// 便签整份写 stickers.json(先写临时文件再改名);图片复制进 images/,文件名由这里起,渲染层只拿得到名字。
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  WALL_IMAGE_FILE_RE,
  WALL_IMAGE_MAX_BYTES,
  sanitizeWallStickers,
  sniffWallImage,
  type WallImageReadResult,
  type WallImageSaveResult,
  type WallSticker
} from '../shared/wikiWallNotes.ts'
import { isSamePath } from './wikiStore.ts'

export const WALL_DIR = '.codeatlas-wall'
const STICKERS_FILE = 'stickers.json'
const IMAGES_DIR = 'images'
/** 刚存进来、还没写进便签存档的图片先别回收,免得和保存撞车误删 */
const GC_GRACE_MS = 10 * 60 * 1000

const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as const

function stickersPath(projectDir: string): string {
  return join(projectDir, WALL_DIR, STICKERS_FILE)
}

function imagesDir(projectDir: string): string {
  return join(projectDir, WALL_DIR, IMAGES_DIR)
}

interface StoredWall {
  projectRoot: string | null
  stickers: WallSticker[]
}

export async function readWallStickers(projectDir: string): Promise<StoredWall> {
  const text = await fs.readFile(stickersPath(projectDir), 'utf8').catch(() => null)
  if (text === null) return { projectRoot: null, stickers: [] }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    return {
      projectRoot: typeof raw.projectRoot === 'string' ? raw.projectRoot : null,
      stickers: sanitizeWallStickers(raw.stickers)
    }
  } catch (err) {
    // 坏文件不覆盖丢弃:原样留着,下次保存前先备份
    console.warn('[wiki] 线索桌便签存档读不出来', { file: stickersPath(projectDir), err })
    return { projectRoot: null, stickers: [] }
  }
}

/** 目录里只有线索桌存档、还没生成过 Wiki 时,靠存档里的项目路径认回原目录 */
export async function isWallOwner(projectDir: string, projectRoot: string): Promise<boolean> {
  const stored = await readWallStickers(projectDir)
  return stored.projectRoot !== null && isSamePath(stored.projectRoot, projectRoot)
}

export async function writeWallStickers(
  projectDir: string,
  projectRoot: string,
  raw: unknown
): Promise<void> {
  const stickers = sanitizeWallStickers(raw)
  const file = stickersPath(projectDir)
  await fs.mkdir(join(projectDir, WALL_DIR), { recursive: true })
  await backupIfDamaged(file)
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify({ version: 1, projectRoot, stickers }, null, 2), 'utf8')
  await fs.rename(tmp, file)
  await collectUnusedImages(projectDir, stickers)
}

/** 旧存档读不出来时先另存一份再覆盖,用户写过的字还能手动找回 */
async function backupIfDamaged(file: string): Promise<void> {
  const text = await fs.readFile(file, 'utf8').catch(() => null)
  if (text === null) return
  try {
    JSON.parse(text)
  } catch {
    await fs.copyFile(file, `${file}.bad-${Date.now()}`).catch(() => undefined)
  }
}

/** 删掉不再被任何便签引用的图片;只收应用自己起名的文件,用户手放的东西不动 */
async function collectUnusedImages(projectDir: string, stickers: WallSticker[]): Promise<void> {
  const used = new Set(stickers.flatMap((s) => (s.kind === 'photo' ? [s.file] : [])))
  const dir = imagesDir(projectDir)
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const now = Date.now()
  for (const name of names) {
    if (!WALL_IMAGE_FILE_RE.test(name) || used.has(name)) continue
    const stat = await fs.stat(join(dir, name)).catch(() => null)
    if (stat === null || now - stat.mtimeMs < GC_GRACE_MS) continue
    await fs.rm(join(dir, name), { force: true })
  }
}

export async function saveWallImage(
  projectDir: string,
  raw: unknown
): Promise<WallImageSaveResult> {
  const bytes =
    raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null
  if (bytes === null || bytes.byteLength === 0) return { ok: false, error: '没收到图片内容' }
  if (bytes.byteLength > WALL_IMAGE_MAX_BYTES)
    return { ok: false, error: '图片超过 10MB,换一张小点的' }
  const ext = sniffWallImage(bytes)
  if (ext === null) return { ok: false, error: '只支持 PNG、JPG、GIF、WebP 图片' }
  const file = `${randomUUID()}.${ext}`
  await fs.mkdir(imagesDir(projectDir), { recursive: true })
  await fs.writeFile(join(imagesDir(projectDir), file), bytes)
  return { ok: true, file }
}

export async function readWallImage(
  projectDir: string,
  file: unknown
): Promise<WallImageReadResult> {
  if (typeof file !== 'string' || !WALL_IMAGE_FILE_RE.test(file)) {
    return { ok: false, error: '图片名不合法' }
  }
  const bytes = await fs.readFile(join(imagesDir(projectDir), file)).catch(() => null)
  if (bytes === null) return { ok: false, error: '图片文件不见了' }
  const ext = sniffWallImage(bytes)
  if (ext === null) return { ok: false, error: '图片文件已损坏' }
  return { ok: true, url: `data:${MIME[ext]};base64,${bytes.toString('base64')}` }
}
