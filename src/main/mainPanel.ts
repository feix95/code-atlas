import type { BrowserWindow } from 'electron'

/** 右键菜单「主面板」项的文案(纯函数):主面板在屏上就给「藏起它」,
 * 不在就给「叫它出来」—— 在屏上还显示「显示主面板」是句废话 */
export function mainPanelMenuLabel(mainVisible: boolean): string {
  return mainVisible ? '隐藏主面板' : '显示主面板'
}

export class MainPanelController {
  private shown: boolean
  private readonly win: BrowserWindow
  /** 「在不在屏上」翻账时喊一声:托盘菜单照真实状态换文案 */
  onShownChange: ((shown: boolean) => void) | null = null

  constructor(win: BrowserWindow) {
    this.win = win
    this.shown = win.isVisible() && !win.isMinimized()
    win.on('show', () => {
      this.setShown(true)
    })
    win.on('restore', () => {
      this.setShown(true)
    })
    win.on('hide', () => {
      this.setShown(false)
    })
    win.on('minimize', () => {
      this.setShown(false)
    })
    win.on('closed', () => {
      this.setShown(false)
    })
  }

  private setShown(shown: boolean): void {
    if (this.shown === shown) return
    this.shown = shown
    this.onShownChange?.(shown)
  }

  isShown(): boolean {
    return this.shown && !this.win.isDestroyed() && !this.win.isMinimized()
  }

  show(): void {
    if (this.win.isDestroyed()) return
    if (this.win.isMinimized()) this.win.restore()
    this.win.show()
    this.win.webContents.invalidate()
    this.win.focus()
    this.setShown(true)
  }

  hide(): void {
    if (this.win.isDestroyed()) return
    this.setShown(false)
    this.win.hide()
  }
}
