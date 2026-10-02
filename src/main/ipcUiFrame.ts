// UI 框架 · 规格包导出(§13、§1.5):只写用户在对话框里自选的位置,从不碰任何用户项目。
// 渲染层给出全部文本文件 + 字体清单 + 截图清单;主进程校验路径、写盘、复制字体、截图。
// §14 导入同在本文件:只读用户自选的方案文件夹 / token 文件,不写一字。
import { BrowserWindow, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import { CH } from '../shared/ipcChannels.ts'
import type { FontPlan, PreviewPlan, UiFrameExportResult } from '../shared/uiFrame/types.ts'
import { unpackUiframe } from '../shared/uiFrame/uiframeFile.ts'
import { currentWasmOpts } from '../native/wasmPaths.ts'
import { FONT_FILE_RE, UI_FRAME_FONT_DIRS, uiFrameFontDir } from '../native/uiFrameFonts.ts'
import { pickPathDialog } from './atlasWindow.ts'
import { captureHtml } from './uiFrameCapture.ts'

interface ExportPayload {
  folderName: string
  files: Record<string, string>
  fonts: FontPlan[]
  previews: PreviewPlan[]
}

/** 规格包内相对路径:不许绝对路径、不许 ..、只认常见字符 */
function isSafeRel(p: string): boolean {
  if (!p || isAbsolute(p) || p.includes('\\')) return false
  if (p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')) return false
  return /^[\w\u4e00-\u9fff.\-/]+$/.test(p)
}

function parsePayload(raw: unknown): ExportPayload {
  if (typeof raw !== 'object' || raw === null) throw new Error('导出参数不合法')
  const p = raw as Record<string, unknown>
  const folderName = typeof p['folderName'] === 'string' ? p['folderName'] : ''
  if (!isSafeRel(folderName) || folderName.includes('/'))
    throw new Error(`导出文件夹名不合法:${folderName}`)
  const files = p['files']
  if (typeof files !== 'object' || files === null) throw new Error('导出文件清单缺失')
  for (const [rel, text] of Object.entries(files)) {
    if (!isSafeRel(rel) || typeof text !== 'string') throw new Error(`导出文件路径不合法:${rel}`)
  }
  const fonts = Array.isArray(p['fonts']) ? (p['fonts'] as FontPlan[]) : []
  for (const plan of fonts) {
    if (!UI_FRAME_FONT_DIRS.includes(plan.dir))
      throw new Error(`字体目录不合法:${String(plan.dir)}`)
    for (const f of plan.files) if (!FONT_FILE_RE.test(f)) throw new Error(`字体文件名不合法:${f}`)
  }
  const previews = Array.isArray(p['previews']) ? (p['previews'] as PreviewPlan[]) : []
  for (const pv of previews) {
    if (!isSafeRel(pv.html) || !isSafeRel(pv.png)) throw new Error(`截图路径不合法:${pv.html}`)
  }
  return { folderName, files: files as Record<string, string>, fonts, previews }
}

/** 同名文件夹已存在就加序号,绝不覆盖用户已有内容 */
async function uniqueDir(parent: string, name: string): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const dir = join(parent, i === 1 ? name : `${name}(${i})`)
    const taken = await fs.stat(dir).then(
      () => true,
      () => false
    )
    if (!taken) return dir
  }
  throw new Error(`同名文件夹过多:${join(parent, name)}`)
}

async function writeFiles(target: string, files: Record<string, string>): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    const abs = normalize(join(target, rel))
    if (!abs.startsWith(target)) throw new Error(`导出路径越界:${rel}`)
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(abs, text, 'utf8')
  }
}

async function copyFonts(target: string, plans: FontPlan[]): Promise<void> {
  const opts = currentWasmOpts()
  for (const plan of plans) {
    const src = uiFrameFontDir(plan.dir, opts)
    const dest = join(target, 'fonts', plan.dir)
    await fs.mkdir(dest, { recursive: true })
    for (const file of plan.files) {
      await fs.copyFile(join(src, file), join(dest, file)).catch((err: Error) => {
        throw new Error(`复制字体失败:${join(src, file)}(${err.message})`)
      })
    }
  }
}

async function writePreviews(target: string, previews: PreviewPlan[]): Promise<string[]> {
  const unloaded: string[] = []
  for (const pv of previews) {
    const shot = await captureHtml(join(target, pv.html), pv.width, pv.height)
    const png = shot.fontsLoaded ? pv.png : pv.png.replace(/\.png$/, '_字体未加载.png')
    await fs.mkdir(join(target, 'preview'), { recursive: true })
    await fs.writeFile(join(target, png), shot.png)
    if (!shot.fontsLoaded) unloaded.push(png)
  }
  return unloaded
}

let lastExportDir: string | null = null

/** 导入文件的大小上限(4MB;变量文件远到不了这个量级) */
const IMPORT_MAX_BYTES = 4 * 1024 * 1024

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    const stat = await fs.stat(path)
    if (stat.size > IMPORT_MAX_BYTES)
      throw new Error(`文件过大(>${IMPORT_MAX_BYTES / 1024 / 1024}MB)`)
    return await fs.readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export interface SchemeFolderPayload {
  manifest: string | null
  design: string
  /** 文件夹名(方案名兜底) */
  name: string
}

export interface ImportFilePayload {
  name: string
  text: string
}

export function registerUiFrameIpc(): void {
  ipcMain.handle(CH.uiFrameExport, async (event, raw: unknown): Promise<UiFrameExportResult> => {
    const payload = parsePayload(raw)
    const parent = await pickPathDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '选择规格包的保存位置',
      properties: ['openDirectory', 'createDirectory']
    })
    if (!parent) return { status: 'canceled' }
    const target = await uniqueDir(parent, payload.folderName)
    await fs.mkdir(target, { recursive: true })
    await writeFiles(target, payload.files)
    await copyFonts(target, payload.fonts)
    const unloadedFontPreviews = await writePreviews(target, payload.previews)
    lastExportDir = target
    return { status: 'done', path: target, unloadedFontPreviews }
  })

  // 只打开最近一次导出的文件夹:渲染层不能借这个通道打开任意路径
  ipcMain.handle(CH.uiFrameRevealExport, async () => {
    if (!lastExportDir) return false
    const err = await shell.openPath(lastExportDir)
    return err === ''
  })

  // ── 导入(§14):全部只读用户自选路径 ──
  // .uiframe 方案文件(§15 zip 容器):读字节 → 解包 → 透传 manifest/design 给渲染层复用文件夹导入的清洗
  ipcMain.handle(CH.uiFrameImportUiframe, async (event): Promise<SchemeFolderPayload | null> => {
    const file = await pickPathDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '选择 .uiframe 方案文件',
      properties: ['openFile'],
      filters: [{ name: 'CodeAtlas 方案', extensions: ['uiframe'] }]
    })
    if (!file) return null
    const stat = await fs.stat(file)
    if (stat.size > IMPORT_MAX_BYTES)
      throw new Error(`文件过大(>${IMPORT_MAX_BYTES / 1024 / 1024}MB)`)
    const { manifest, design } = unpackUiframe(new Uint8Array(await fs.readFile(file)))
    const name =
      file
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.uiframe$/i, '') ?? '导入方案'
    return { manifest, design, name }
  })

  ipcMain.handle(CH.uiFrameImportFolder, async (event): Promise<SchemeFolderPayload | null> => {
    const dir = await pickPathDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '选择方案文件夹(含 design.json)',
      properties: ['openDirectory']
    })
    if (!dir) return null
    const design = await readTextIfExists(join(dir, 'design.json'))
    if (design === null) throw new Error(`文件夹里没有 design.json:${dir}`)
    const manifest = await readTextIfExists(join(dir, 'manifest.json'))
    const name =
      dir
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() ?? '导入方案'
    return { manifest, design, name }
  })

  ipcMain.handle(
    CH.uiFrameImportFile,
    async (event, rawKind: unknown): Promise<ImportFilePayload | null> => {
      const kind = rawKind === 'css' ? 'css' : 'json'
      const file = await pickPathDialog(BrowserWindow.fromWebContents(event.sender), {
        title: kind === 'css' ? '选择 CSS 变量文件' : '选择 DTCG 变量 JSON',
        properties: ['openFile'],
        filters:
          kind === 'css'
            ? [{ name: 'CSS 文件', extensions: ['css'] }]
            : [{ name: 'JSON 文件', extensions: ['json'] }]
      })
      if (!file) return null
      const text = await readTextIfExists(file)
      if (text === null) throw new Error(`文件读不到:${file}`)
      return { name: file.split(/[\\/]/).pop() ?? 'import', text }
    }
  )
}
