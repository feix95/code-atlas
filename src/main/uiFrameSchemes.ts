// 「我的方案」库(第 5.8 节、第 15 节):userData/ui-frame-schemes/<id>/ 一方案一文件夹。
// 文件结构 = 方案文件本体(manifest.json + design.json + thumbnail.png)+ snapshots/ 历史快照。
// 只写方案库目录与用户自选的导出位置,不碰任何用户项目。
import { app, BrowserWindow, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { join, normalize } from 'node:path'
import { CH } from '../shared/ipcChannels.ts'
import {
  manifestFor,
  parseDoc,
  schemeIdFromName,
  SCHEME_ID_RE,
  serializeDoc,
  snapshotStamp,
  SNAPSHOT_RE
} from '../shared/uiFrame/scheme.ts'
import type {
  SchemeBundle,
  SchemeManifest,
  SchemeMeta,
  SchemeSavePayload,
  UiFrameExportResult
} from '../shared/uiFrame/types.ts'
import { pickSaveDialog } from './atlasWindow.ts'
import { packUiframe } from '../shared/uiFrame/uiframeFile.ts'
import { userDataDir } from './paths.ts'
import { captureHtml } from './uiFrameCapture.ts'

const schemesRoot = (): string => join(userDataDir(), 'ui-frame-schemes')

/** 渲染层给的 id 必须是合法文件夹名,且确实在方案库里 */
function schemeDir(rawId: unknown): string {
  const id = typeof rawId === 'string' ? rawId : ''
  if (!SCHEME_ID_RE.test(id)) throw new Error(`方案 id 不合法:${id}`)
  const dir = normalize(join(schemesRoot(), id))
  if (!dir.startsWith(normalize(schemesRoot()))) throw new Error(`方案路径越界:${id}`)
  return dir
}

async function readManifest(dir: string): Promise<SchemeManifest | null> {
  try {
    const raw = JSON.parse(await fs.readFile(join(dir, 'manifest.json'), 'utf8')) as SchemeManifest
    return raw.formatVersion === 1 ? raw : null
  } catch {
    return null
  }
}

async function readThumb(dir: string): Promise<string | null> {
  try {
    const png = await fs.readFile(join(dir, 'thumbnail.png'))
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

/** 新方案落库:文件夹名 = 名字 slug,撞名加序号,绝不覆盖 */
async function newSchemeDir(name: string): Promise<{ id: string; dir: string }> {
  const stamp = snapshotStamp()
  for (let i = 1; i < 100; i++) {
    const id = `${schemeIdFromName(name, stamp)}${i === 1 ? '' : `-${i}`}`
    const dir = join(schemesRoot(), id)
    const taken = await fs.stat(dir).then(
      () => true,
      () => false
    )
    if (!taken) return { id, dir }
  }
  throw new Error('同名方案过多')
}

/** 模板 id → 风格名(manifest.style);未知模板记「自定义」 */
const TEMPLATE_STYLES: Record<string, string> = {
  'minimal-desk': '极简中性',
  'modern-desk': '现代简洁',
  'tint-phone': '色调圆角',
  'airy-phone': '留白清透',
  blank: '空白起步'
}

/** 生成缩略图:写临时 html → 离屏截图 → thumbnail.png;失败不阻塞保存 */
async function writeThumbnail(dir: string, thumbHtml: string): Promise<void> {
  if (!thumbHtml) return
  const tmp = join(dir, '__thumb.html')
  try {
    await fs.writeFile(tmp, thumbHtml, 'utf8')
    const shot = await captureHtml(tmp, 640, 400)
    await fs.writeFile(join(dir, 'thumbnail.png'), shot.png)
  } catch {
    // 缩略图不是方案本体,失败就跳过
  } finally {
    await fs.rm(tmp, { force: true })
  }
}

async function writeScheme(dir: string, payload: SchemeSavePayload): Promise<SchemeManifest> {
  const id = dir.split(/[\\/]/).pop() ?? ''
  const doc = parseDoc(JSON.stringify(payload.doc))
  doc.name = payload.name.trim() || '未命名方案'
  const prev = await readManifest(dir)
  const manifest = manifestFor(doc, {
    id,
    style:
      payload.doc.template in TEMPLATE_STYLES ? TEMPLATE_STYLES[payload.doc.template] : '自定义',
    createdAt: prev?.createdAt ?? new Date().toISOString(),
    appVersion: app.getVersion()
  })
  manifest.name = doc.name
  const design = serializeDoc(doc)
  await fs.mkdir(join(dir, 'snapshots'), { recursive: true })
  await fs.writeFile(join(dir, 'design.json'), design, 'utf8')
  await fs.writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await fs.writeFile(join(dir, 'snapshots', `${snapshotStamp()}.json`), design, 'utf8')
  await writeThumbnail(dir, payload.thumbHtml)
  return manifest
}

export function registerUiFrameSchemeIpc(): void {
  ipcMain.handle(CH.uiFrameSchemeList, async (): Promise<SchemeMeta[]> => {
    const root = schemesRoot()
    const names = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    const out: SchemeMeta[] = []
    for (const entry of names) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      const manifest = await readManifest(dir)
      if (!manifest) continue
      out.push({
        id: manifest.id,
        name: manifest.name,
        platform: manifest.platform,
        style: manifest.style,
        modifiedAt: manifest.modifiedAt,
        thumbnail: await readThumb(dir)
      })
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  })

  ipcMain.handle(CH.uiFrameSchemeOpen, async (_e, rawId: unknown): Promise<SchemeBundle> => {
    const dir = schemeDir(rawId)
    const manifest = await readManifest(dir)
    if (!manifest) throw new Error(`方案不存在:${String(rawId)}`)
    const design = await fs.readFile(join(dir, 'design.json'), 'utf8')
    return { manifest, design }
  })

  ipcMain.handle(
    CH.uiFrameSchemeSave,
    async (_e, raw: unknown): Promise<{ id: string; manifest: SchemeManifest }> => {
      const p = raw as SchemeSavePayload
      if (typeof p?.name !== 'string' || typeof p?.doc !== 'object') {
        throw new Error('保存参数不合法')
      }
      const dir = p.id ? schemeDir(p.id) : (await newSchemeDir(p.name)).dir
      const manifest = await writeScheme(dir, { ...p, name: p.name.trim() || '未命名方案' })
      return { id: manifest.id, manifest }
    }
  )

  ipcMain.handle(
    CH.uiFrameSchemeRename,
    async (_e, rawId: unknown, rawName: unknown): Promise<void> => {
      const dir = schemeDir(rawId)
      const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null
      if (!name) throw new Error('方案名不能为空')
      const manifest = await readManifest(dir)
      if (!manifest) throw new Error('方案不存在')
      manifest.name = name
      manifest.modifiedAt = new Date().toISOString()
      await fs.writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      const designPath = join(dir, 'design.json')
      const doc = parseDoc(await fs.readFile(designPath, 'utf8'))
      doc.name = name
      await fs.writeFile(designPath, `${JSON.stringify(doc, null, 2)}\n`)
    }
  )

  ipcMain.handle(CH.uiFrameSchemeDelete, async (_e, rawId: unknown): Promise<void> => {
    await fs.rm(schemeDir(rawId), { recursive: true, force: true })
  })

  ipcMain.handle(CH.uiFrameSchemeSnapshots, async (_e, rawId: unknown): Promise<string[]> => {
    const dir = join(schemeDir(rawId), 'snapshots')
    const names = await fs.readdir(dir).catch(() => [] as string[])
    return names
      .filter((n) => SNAPSHOT_RE.test(n))
      .sort()
      .reverse()
  })

  ipcMain.handle(
    CH.uiFrameSchemeRestore,
    async (_e, rawId: unknown, stamp: unknown): Promise<string> => {
      const name = typeof stamp === 'string' ? stamp : ''
      if (!SNAPSHOT_RE.test(name)) throw new Error(`快照名不合法:${name}`)
      return fs.readFile(join(schemeDir(rawId), 'snapshots', name), 'utf8')
    }
  )

  // 导出为 .uiframe 方案文件(第 15 节 zip 容器):manifest + design + thumbnail 打进单文件,不带快照
  ipcMain.handle(
    CH.uiFrameSchemeExport,
    async (event, rawId: unknown): Promise<UiFrameExportResult> => {
      const dir = schemeDir(rawId)
      const manifest = await readManifest(dir)
      if (!manifest) throw new Error('方案不存在')
      const target = await pickSaveDialog(BrowserWindow.fromWebContents(event.sender), {
        title: '导出方案文件',
        defaultPath: `${manifest.name}.uiframe`,
        filters: [{ name: 'CodeAtlas 方案', extensions: ['uiframe'] }]
      })
      if (!target) return { status: 'canceled' }
      const thumbnail = await fs.readFile(join(dir, 'thumbnail.png')).catch(() => null)
      const design = await fs.readFile(join(dir, 'design.json'), 'utf8')
      // 自定义图标(M3-e)随包走一份文件形态:assets/icons/custom-<名>.svg
      const icons: Record<string, Uint8Array> = {}
      try {
        const parsed = JSON.parse(design) as { customIcons?: Record<string, unknown> }
        for (const [key, svg] of Object.entries(parsed.customIcons ?? {})) {
          if (typeof svg === 'string' && /^[\w一-龥.-]{1,40}$/.test(key)) {
            icons[`custom-${key}.svg`] = new TextEncoder().encode(svg)
          }
        }
      } catch {
        // design.json 解析失败时照原样打包,自定义图标缺席不挡导出
      }
      const zipped = packUiframe({
        manifest: JSON.stringify(manifest),
        design,
        thumbnail,
        icons
      })
      await fs.writeFile(target, zipped)
      return { status: 'done', path: target, unloadedFontPreviews: [] }
    }
  )
}
