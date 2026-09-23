/**
 * JSON 小存档的读写骨架(P2-14 公共件,主进程和 ai 层共用):
 * readJsonFile —— 没写过/读不动/内容是垃圾,一律回 null,调用方走默认;
 * writeJsonFile —— 统一 2 空格缩进 utf8;写不进去就安静放过
 * (这些记事本是锦上添花,不该惊动任何人)。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export function readJsonFile(file: string): unknown | null {
  try {
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function writeJsonFile(file: string, value: unknown): void {
  try {
    writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
  } catch {
    // 安静放过
  }
}
