// 文件树备注的显示开关(默认开):关了只藏显示 —— 行内小笔标、悬停里的备注话术一起收,
// 备注数据不动,右键菜单照旧能编辑/清除。存 localStorage:界面的事每台机器自己一套,
// 重启不失忆,不进 AI 配置文件。

import { readFlagPref, writeFlagPref } from '../../shared/localPrefs.ts'

const NOTES_SHOWN_KEY = 'atlas.treeNotesShown'

export function readNotesShown(): boolean {
  return readFlagPref(NOTES_SHOWN_KEY, true)
}

export function writeNotesShown(on: boolean): void {
  writeFlagPref(NOTES_SHOWN_KEY, on)
}
