import { app, dialog, ipcMain, shell, BrowserWindow, type OpenDialogOptions } from 'electron'
import { join } from 'node:path'
import { scanDirectory } from '../scanner/index.ts'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'CodeAtlas',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // 外部链接交给系统浏览器打开,不在应用里开新窗口
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式加载 Vite 开发服务器,打包后加载本地文件
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  // 弹出系统"选择文件夹"对话框,返回所选路径;取消则返回 null
  ipcMain.handle('atlas:pick-folder', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const options: OpenDialogOptions = { properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  // 扫描指定文件夹,返回目录树 + 统计
  ipcMain.handle('atlas:scan-folder', (_event, folderPath: unknown) => {
    if (typeof folderPath !== 'string' || folderPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    return scanDirectory(folderPath)
  })
}

app.whenReady().then(() => {
  createWindow()
  registerIpc()

  // macOS:点 Dock 图标时,没有窗口就重新建一个
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Windows / Linux:关掉所有窗口就退出应用
  if (process.platform !== 'darwin') app.quit()
})
