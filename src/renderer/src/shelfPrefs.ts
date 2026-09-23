// 模型货架的筛选偏好(2026-09-18,小葵报「筛选状态不保存,下次打开又是默认」):
// 存 localStorage —— 界面的事,每台机器自己一套,不进 AI 配置文件。
// 照 chatPrefs 的家规:坏档/缺字段当没配过,回默认,不炸界面(读写骨架走 shared/localPrefs)。

import { readPref, writePref } from '../../shared/localPrefs.ts'

export interface ShelfPrefs {
  /** 大小上限 GB;null = 不限(与货架筛选按钮的取值一一对应) */
  maxGb: number | null
  sortBy: 'downloads' | 'lastModified'
  desc: boolean
}

const SHELF_PREFS_KEY = 'atlas.shelfPrefs'

export const DEFAULT_SHELF_PREFS: ShelfPrefs = { maxGb: null, sortBy: 'downloads', desc: true }

/** 筛选按钮允许的档位,存档校验用:档位外的一律回「不限」,不认野值 */
const ALLOWED_MAX_GB = [4, 8, 16, 32]

export function loadShelfPrefs(): ShelfPrefs {
  const p = readPref<Partial<ShelfPrefs> | null>(SHELF_PREFS_KEY, null)
  if (p === null || typeof p !== 'object') return DEFAULT_SHELF_PREFS
  return {
    maxGb: typeof p.maxGb === 'number' && ALLOWED_MAX_GB.includes(p.maxGb) ? p.maxGb : null,
    sortBy: p.sortBy === 'lastModified' ? 'lastModified' : 'downloads',
    desc: p.desc !== false
  }
}

export function saveShelfPrefs(p: ShelfPrefs): void {
  writePref(SHELF_PREFS_KEY, p)
}
