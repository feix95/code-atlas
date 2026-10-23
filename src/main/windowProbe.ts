// 验收探针:只在设了 ATLAS_PROBE_DIR 时启用 —— 露窗后截整窗图 + 记账再退出,
// 专门伺候「100%/125%/150% 三档缩放实测」当证据;正常跑应用完全不碰这段。
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

export function runAcceptanceProbe(mainWindow: BrowserWindow, shownVia: string): void {
  const probeDir = process.env['ATLAS_PROBE_DIR']
  if (!probeDir) return
  void (async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500)) // 露窗后再稳两秒半,让画面完全落定
    const scale = await mainWindow.webContents
      .executeJavaScript('String(window.devicePixelRatio)')
      .catch(() => 'unknown')
    const image = await mainWindow.webContents.capturePage().catch(() => null)
    const png = image ? image.toPNG() : Buffer.alloc(0)
    const report = {
      devicePixelRatio: scale,
      shownVia,
      visible: mainWindow.isVisible(),
      maximized: mainWindow.isMaximized(),
      bounds: mainWindow.getBounds(),
      pngBytes: png.length
    }
    await fs.mkdir(probeDir, { recursive: true })
    await fs.writeFile(join(probeDir, `probe-dpr${scale}.json`), JSON.stringify(report, null, 2))
    if (png.length > 0) await fs.writeFile(join(probeDir, `probe-dpr${scale}.png`), png)
    app.quit()
  })()
}
