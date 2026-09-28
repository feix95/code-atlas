// 代码预览的偏好开关:存 localStorage(界面的事,每台机器自己一套,不进 AI 配置文件)。
// 第一条:自动换行 —— 默认开;关掉回到长行横向滚动。超行数闸的文件折行摁不动,
// 这个偏好只是「想要不要」,给不给是行数闸说了算(见 CodePreview 的 WRAP_MAX_LINES)。

import { readFlagPref, writeFlagPref } from '../../shared/localPrefs.ts'

export const CODE_WRAP_KEY = 'atlas.codeWrap'

export function loadCodeWrapOn(): boolean {
  // 没配过 = 默认开(全局一档,不分文件后缀)
  return readFlagPref(CODE_WRAP_KEY, true)
}

export function saveCodeWrapOn(on: boolean): void {
  writeFlagPref(CODE_WRAP_KEY, on)
}
