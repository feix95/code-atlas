// 立项问卷(§3.6 路径一):立项单 .md 写到用户在保存对话框里自选的位置,不写别处。
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { CH } from '../shared/ipcChannels.ts'
import type { QuizBriefSaveResult } from '../shared/quiz/types.ts'

export function registerQuizIpc(): void {
  ipcMain.handle(CH.quizBriefSave, async (event, raw: unknown): Promise<QuizBriefSaveResult> => {
    const payload = (raw ?? {}) as { name?: unknown; text?: unknown }
    const text = typeof payload.text === 'string' ? payload.text : null
    if (text === null || text === '') return { status: 'canceled' }
    const base =
      typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : '立项单'
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.SaveDialogOptions = {
      title: '立项单.md 存到哪里',
      defaultPath: `${base}-立项单.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { status: 'canceled' }
    await fs.writeFile(res.filePath, text, 'utf8')
    return { status: 'done', path: res.filePath }
  })
}
