// 线索桌便签与图片的主进程入口:读写便签存档、存图与取图。
// 渲染层递来的项目路径当外部输入,只经 parseProjectRoot;落盘位置由 Wiki 根与项目目录解析决定。
import { ipcMain } from 'electron'
import { CH } from '../shared/ipcChannels.ts'
import type {
  WallImageReadResult,
  WallImageSaveResult,
  WallStickersLoadResult,
  WallStickersSaveResult
} from '../shared/wikiWallNotes.ts'
import { userDataDir } from './paths.ts'
import { parseProjectRoot } from './wikiRequest.ts'
import { loadWikiSettings } from '../wiki/wikiSettings.ts'
import { resolveProjectDir } from '../wiki/wikiProjectDir.ts'
import {
  readWallImage,
  readWallStickers,
  saveWallImage,
  writeWallStickers
} from '../wiki/wikiWallNotesStore.ts'

const NO_LOCATION = '先在设置里选好 Wiki 存放位置,便签和图片跟 Wiki 存在一起'

async function projectDirOf(
  raw: unknown
): Promise<{ dir: string; root: string } | { error: string }> {
  const root = parseProjectRoot(raw)
  if (root === null) return { error: '项目路径不合法' }
  const location = loadWikiSettings(userDataDir()).location
  if (location === null) return { error: NO_LOCATION }
  return { dir: await resolveProjectDir(location, root), root }
}

function failText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerWikiWallIpc(): void {
  ipcMain.handle(
    CH.wikiWallStickersLoad,
    async (_e, root: unknown): Promise<WallStickersLoadResult> => {
      const target = await projectDirOf(root)
      if ('error' in target) return { ok: false, error: target.error }
      return { ok: true, stickers: (await readWallStickers(target.dir)).stickers }
    }
  )
  ipcMain.handle(
    CH.wikiWallStickersSave,
    async (_e, root: unknown, stickers: unknown): Promise<WallStickersSaveResult> => {
      const target = await projectDirOf(root)
      if ('error' in target) return { ok: false, error: target.error }
      try {
        await writeWallStickers(target.dir, target.root, stickers)
        return { ok: true }
      } catch (err) {
        console.warn('[wiki] 线索桌便签保存失败', { dir: target.dir, err })
        return { ok: false, error: `便签没存上:${failText(err)}` }
      }
    }
  )
  ipcMain.handle(
    CH.wikiWallImageSave,
    async (_e, root: unknown, bytes: unknown): Promise<WallImageSaveResult> => {
      const target = await projectDirOf(root)
      if ('error' in target) return { ok: false, error: target.error }
      try {
        return await saveWallImage(target.dir, bytes)
      } catch (err) {
        console.warn('[wiki] 线索桌图片保存失败', { dir: target.dir, err })
        return { ok: false, error: `图片没存上:${failText(err)}` }
      }
    }
  )
  ipcMain.handle(
    CH.wikiWallImageRead,
    async (_e, root: unknown, file: unknown): Promise<WallImageReadResult> => {
      const target = await projectDirOf(root)
      if ('error' in target) return { ok: false, error: target.error }
      return readWallImage(target.dir, file)
    }
  )
}
