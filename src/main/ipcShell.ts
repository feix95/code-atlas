import { openDevLogWindow, setUiScaleFactor } from './appShell.ts'
import { accessDeniedMessage } from './aiEvidence.ts'
import { app, ipcMain, BrowserWindow, type OpenDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { clearDevLogs, devLogSnapshot } from '../shared/devlog.ts'
import { pickPathDialog } from './atlasWindow.ts'
import { CH } from '../shared/ipcChannels.ts'
import { clampUiScale } from '../shared/uiScale.ts'
import { queryDriveKinds } from './drive-meta.ts'
import { IGNORED_NAMES } from '../scanner/index.ts'
import type { BrowseEntry, DriveInfo } from '../shared/types.ts'

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

  // 页签尾空白的手动搬窗:那块地是右键菜单+拖放落点的地盘,铺不了 app-region:drag
  // (drag 区不吃 contextmenu/dragover),渲染层改报光标的绝对屏幕坐标,主进程挪窗。
  // ⚠ 雷区档案②(第九十锤实证):150% 缩放下每写一次 bounds 窗体偷长 1px
  // (DIP↔物理像素取整偏差,黑匣子 1432x969→1700x1250 连涨 380 次)——
  // 治法:拖窗起点锁一份基准矩形,尺寸恒写它(偷长收敛于一处不回读),
  // 位置按「基准 + 总位移」绝对回放,不攒增量不喂回声。
  // start 只在最大化时有额外活:先还原,窗顶回工作区顶,光标保持它在条上的水平比例位
  let dragBase: {
    bx: number
    by: number
    w: number
    h: number
    cx: number
    cy: number
    lx: number
    ly: number
  } | null = null
  const isXY = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  ipcMain.on(CH.windowDragStart, (event, x: unknown, y: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || !isXY(x) || !isXY(y)) return
    if (win.isMaximized()) {
      const before = win.getBounds()
      win.unmaximize()
      const restored = win.getBounds()
      const ratio = before.width > 0 ? Math.min(1, Math.max(0, (x - before.x) / before.width)) : 0.5
      const bx = Math.round(x - restored.width * ratio)
      const by = before.y
      win.setBounds({ x: bx, y: by, width: restored.width, height: restored.height })
      dragBase = { bx, by, w: restored.width, h: restored.height, cx: x, cy: y, lx: bx, ly: by }
      return
    }
    const b = win.getBounds()
    dragBase = { bx: b.x, by: b.y, w: b.width, h: b.height, cx: x, cy: y, lx: b.x, ly: b.y }
  })
  ipcMain.on(CH.windowDragMove, (event, x: unknown, y: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || win.isMaximized() || !isXY(x) || !isXY(y)) return
    if (!dragBase) {
      // 漏了 start(不该发生,兜底):以当下为基线,这一帧不挪
      const b = win.getBounds()
      dragBase = { bx: b.x, by: b.y, w: b.width, h: b.height, cx: x, cy: y, lx: b.x, ly: b.y }
      return
    }
    const nx = Math.round(dragBase.bx + (x - dragBase.cx))
    const ny = Math.round(dragBase.by + (y - dragBase.cy))
    if (nx === dragBase.lx && ny === dragBase.ly) return // 原地不写(雷区①回声)
    win.setBounds({ x: nx, y: ny, width: dragBase.w, height: dragBase.h })
    dragBase.lx = nx
    dragBase.ly = ny
  })

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

  // 「这台电脑」下钻(UI v3 §7.1):列某目录的直属一层,不递归 —— 侧栏懒加载浏览的口粮。
  // 忽略名单/符号链接的口径与目录扫描一致;打不开的层抛人话错,界面在原地照实说
  ipcMain.handle(CH.browseDir, async (_event, absPath: unknown): Promise<BrowseEntry[]> => {
    if (typeof absPath !== 'string' || absPath.trim() === '') throw new Error('参数不合法')
    const dir = absPath.trim()
    const stat = await fs.stat(dir).catch((err: NodeJS.ErrnoException) => err)
    if (stat instanceof Error) throw new Error(accessDeniedMessage(stat, '文件夹', dir))
    if (!stat.isDirectory()) throw new Error(`这个路径不是一个文件夹:${dir}`)
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err) => {
      throw new Error(accessDeniedMessage(err, '文件夹', dir))
    })
    const out: BrowseEntry[] = []
    for (const e of entries) {
      if (IGNORED_NAMES.has(e.name)) continue
      if (e.isSymbolicLink()) continue
      out.push({ name: e.name, dir: e.isDirectory(), absPath: join(dir, e.name) })
    }
    out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'zh') : a.dir ? -1 : 1))
    return out
  })

  // 渲染层拿不到 app 版本,给个小通道(设置里的版本信息行用)
  ipcMain.handle(CH.appVersion, () => app.getVersion())

  // 渲染层改了整体缩放并落盘 → 报给主进程:窗口记事本按「基准值 × 系数」记账要用它换算
  ipcMain.on(CH.uiScaleSync, (_event, v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) setUiScaleFactor(clampUiScale(v))
  })

  // ── Developer 日志(第八十七锤):拉全量 / 清账 / 开窗 ──
  ipcMain.handle(CH.devLogPull, () => devLogSnapshot())
  ipcMain.handle(CH.devLogClear, () => {
    clearDevLogs()
  })
  ipcMain.handle(CH.devLogOpen, () => {
    openDevLogWindow()
  })
}
