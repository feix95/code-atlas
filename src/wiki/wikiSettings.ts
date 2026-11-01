// Wiki 设置的本地存档:userData 下的 wiki-settings.json,与 appearance.json 做邻居。
// 路径契约:这是 Electron 自己的配置文件,不涉及项目内文件,不经过 joinRoot。
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readJsonFile, writeJsonFile } from '../shared/jsonFile.ts'
import { translateLang } from '../shared/translateLangs.ts'
import { DEFAULT_WIKI_LANGUAGE, type WikiSettings } from '../shared/wikiTypes.ts'

export function wikiSettingsFilePath(userDataDir: string): string {
  return join(userDataDir, 'wiki-settings.json')
}

/** 坏字段一律回默认;位置与「已确认」互相矛盾时以位置为准 */
export function sanitizeWikiSettings(raw: unknown): WikiSettings {
  const record = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const location =
    typeof record.location === 'string' && record.location.trim() !== '' ? record.location : null
  const language =
    typeof record.language === 'string' && translateLang(record.language) !== null
      ? record.language
      : DEFAULT_WIKI_LANGUAGE
  return { location, language, hasChosenLocation: location !== null }
}

export function loadWikiSettings(userDataDir: string): WikiSettings {
  return sanitizeWikiSettings(readJsonFile(wikiSettingsFilePath(userDataDir)))
}

/** 写入前再洗一遍,顺便把清洗后的结果交回调用方 */
export function saveWikiSettings(userDataDir: string, settings: WikiSettings): WikiSettings {
  const clean = sanitizeWikiSettings(settings)
  const file = wikiSettingsFilePath(userDataDir)
  // 首启时 userData 目录可能还没建出来
  mkdirSync(dirname(file), { recursive: true })
  writeJsonFile(file, clean)
  return clean
}
