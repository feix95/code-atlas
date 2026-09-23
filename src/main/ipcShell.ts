import { openDevLogWindow } from './appShell.ts'
import { app, ipcMain, BrowserWindow, type OpenDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import { clearDevLogs, devLogSnapshot } from '../shared/devlog.ts'
import { pickPathDialog } from './atlasWindow.ts'
import { CH } from '../shared/ipcChannels.ts'
import { queryDriveKinds } from './drive-meta.ts'
import type { DriveInfo } from '../shared/types.ts'

export function registerShellIpc(): void {
  // 自绘窗口壳的三颗灰点:关 / 最小化 / 最大化切换。渲染进程不许直接碰 BrowserWindow,一律走这儿
  ipcMain.handle(CH.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle(CH.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle(CH.windowMaximizeToggle, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle(
    CH.windowIsMaximized,
    (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  )

  // 弹出系统"选择文件夹"对话框,返回所选路径;取消则返回 null
  // 第八十八锤:对话框认准来叫它的那个窗,不再抓「[0]」——日志窗开着时别把弹窗挂错门
  ipcMain.handle(CH.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = { properties: ['openDirectory'] }
    return pickPathDialog(win, options)
  })

  // 列盘符(第六十锤):只问 Windows「有哪些盘」,不翻任何文件内容,秒回。
  // 跳过 A/B(软驱遗物,探测可能卡好几秒);容量用 statfs 一次系统调用,拿不到就只给盘符
  // 列盘符(第八十一锤加固,第八十二锤瘦身):①所有盘一起问、单盘 2.5 秒不答就当缺席 ——
  // 掉线的网络映射盘以前能拖住整列;②盘的来路(固定/移动/网络/光驱)一次 PowerShell 问齐,
  // 失败/超时就当没有,盘卡片照常按老样子叫「本地磁盘」,基本面不受影响(带 5 秒小缓存,
  // 回首页重列盘符时不用次次都起 PowerShell)。卷标不再问 —— 小葵拍板:盘就认大写字母,直白
  ipcMain.handle(CH.listDrives, async (): Promise<DriveInfo[]> => {
    /** 单个询问加超时:到点回 null,慢半拍的输家就地安静,不许变未处理的拒绝 */
    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const bell = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms)
      })
      p.catch(() => null)
      return Promise.race([p.catch(() => null), bell]).finally(() => {
        if (timer) clearTimeout(timer)
      })
    }

    const probeLetter = async (ch: string): Promise<DriveInfo | null> => {
      const root = `${ch}:\\`
      const exists = await withTimeout(
        fs.stat(root).then(
          () => true,
          () => false
        ),
        2500
      )
      if (!exists) return null
      const info: DriveInfo = { letter: ch, root }
      const usage = await withTimeout(
        fs.statfs(root).then((s) => ({ free: s.bsize * s.bfree, total: s.bsize * s.blocks })),
        2500
      )
      if (usage) {
        info.free = usage.free
        info.total = usage.total
      }
      return info
    }

    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    const drives = (await Promise.all(letters.map(probeLetter))).filter(
      (d): d is DriveInfo => d !== null
    )
    const kinds = await queryDriveKinds()
    if (kinds) {
      for (const d of drives) {
        const kind = kinds.get(d.letter)
        if (kind) d.kind = kind
      }
    }
    return drives
  })

  // 渲染层拿不到 app 版本,给个小通道(设置里的版本信息行用)
  ipcMain.handle(CH.appVersion, () => app.getVersion())

  // ── Developer 日志(第八十七锤):拉全量 / 清账 / 开窗 ──
  ipcMain.handle(CH.devLogPull, () => devLogSnapshot())
  ipcMain.handle(CH.devLogClear, () => {
    clearDevLogs()
  })
  ipcMain.handle(CH.devLogOpen, () => {
    openDevLogWindow()
  })
}
