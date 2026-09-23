import { app } from 'electron'

/** userData 目录一句缩写(P2-14):本文件十几处存档读写不用每处都写全名 */
export function userDataDir(): string {
  return app.getPath('userData')
}

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}
