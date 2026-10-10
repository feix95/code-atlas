// 预览编辑锤的 IPC 台:saveFile / watchFile / unwatchFile 三条 invoke 配 handle;
// fileChanged 是主进程主动推的事件 —— 同一个文件可能同时被主窗/子窗的签开着,
// 一律全员广播,渲染层自己对账(只对打开中的文件有反应)。
import { BrowserWindow, ipcMain } from 'electron'
import { renameTextFile, saveTextFile } from './fileEdit.ts'
import { FileWatchRegistry } from './fileWatch.ts'
import { joinRoot } from '../shared/paths.ts'
import { CH } from '../shared/ipcChannels.ts'
import type { FileChangedPayload } from '../shared/types.ts'

export function registerEditIpc(): void {
  const watches = new FileWatchRegistry((sig) => {
    const payload: FileChangedPayload = {
      rootPath: sig.rootPath,
      relPath: sig.relPath,
      mtimeMs: sig.mtimeMs
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(CH.fileChanged, payload)
    }
  })

  // 写文件:路径契约同 readPreview,收 (rootPath, relPath);写完顺手给监视器报自家人,
  // 紧跟着的 fs.watch 事件会被对账吞掉,不会弹「外面改了」的假警报
  ipcMain.handle(
    CH.saveFile,
    async (_event, rootPath: unknown, relPath: unknown, text: unknown) => {
      const result = await saveTextFile(rootPath, relPath, text)
      if (typeof rootPath === 'string' && typeof relPath === 'string') {
        watches.noteOwnWrite(joinRoot(rootPath, relPath), result.mtimeMs)
      }
      return result
    }
  )

  // 文件改名(内联标题改名锤):改完顺手给监视器迁户口,老路径上的监工跟着挪去新路径,
  // 不然旧户口的下一跳事件会谎报「文件被删了」
  ipcMain.handle(
    CH.renameFile,
    async (_event, rootPath: unknown, relPath: unknown, newBase: unknown) => {
      const result = await renameTextFile(rootPath, relPath, newBase)
      if (typeof rootPath === 'string' && typeof relPath === 'string') {
        watches.move(
          joinRoot(rootPath, relPath),
          joinRoot(rootPath, result.relPath),
          result.relPath,
          result.mtimeMs
        )
      }
      return result
    }
  )

  // 盯一个打开中的文件;文件刚好读不到(已被删等)时老实回 false,渲染层降级不崩
  ipcMain.handle(CH.watchFile, (_event, rootPath: unknown, relPath: unknown) => {
    if (typeof rootPath !== 'string' || typeof relPath !== 'string') {
      throw new Error('参数不合法')
    }
    return { ok: watches.add(rootPath, relPath, joinRoot(rootPath, relPath)) }
  })

  ipcMain.handle(CH.unwatchFile, (_event, rootPath: unknown, relPath: unknown) => {
    if (typeof rootPath !== 'string' || typeof relPath !== 'string') {
      throw new Error('参数不合法')
    }
    watches.remove(joinRoot(rootPath, relPath))
  })
}
