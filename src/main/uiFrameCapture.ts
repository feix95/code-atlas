// 规格包预览截图(第 13.2 节 规则 15):用离屏窗口打开已写盘的 HTML,等字体加载完成再截。
// 截的是导出后的真实文件,所以截图与 agent 打开同一文件看到的效果一致。
import { BrowserWindow } from 'electron'

/** 单张截图的最长等待;超时视为失败,不让导出卡死 */
const CAPTURE_TIMEOUT_MS = 20_000

const FONT_PROBE = `(async () => {
  await document.fonts.ready
  await Promise.all([
    document.fonts.load('16px "Inter Variable"', 'Ag'),
    document.fonts.load('16px "Noto Sans SC Variable"', '中文')
  ])
  return document.fonts.check('16px "Inter Variable"', 'Ag') &&
    document.fonts.check('16px "Noto Sans SC Variable"', '中文')
})()`

export interface CaptureResult {
  png: Buffer
  fontsLoaded: boolean
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const bell = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}超时(${ms / 1000} 秒)`)), ms)
  })
  return Promise.race([p, bell]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/** height = 0 表示按页面实际高度截全 */
export async function captureHtml(
  htmlPath: string,
  width: number,
  height: number
): Promise<CaptureResult> {
  const win = new BrowserWindow({
    show: false,
    width,
    height: height || 800,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true }
  })
  try {
    return await withTimeout(
      (async () => {
        await win.loadFile(htmlPath)
        const fontsLoaded = (await win.webContents.executeJavaScript(FONT_PROBE)) === true
        if (!height) {
          const full = Number(
            await win.webContents.executeJavaScript(
              'Math.ceil(document.documentElement.scrollHeight)'
            )
          )
          win.setContentSize(width, Math.max(1, full))
        }
        await win.webContents.executeJavaScript(
          'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'
        )
        const image = await win.webContents.capturePage()
        return { png: image.toPNG(), fontsLoaded }
      })(),
      CAPTURE_TIMEOUT_MS,
      `截图 ${htmlPath} `
    )
  } finally {
    win.destroy()
  }
}
