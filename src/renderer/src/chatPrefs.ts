// 聊天面板的偏好开关:存 localStorage(界面的事,每台机器自己一套,不进 AI 配置文件)。
// 读写骨架走 shared/localPrefs。
// 第一条:推荐问题 —— 关掉后聊天框上面和文件预览 AI 卡下面那排「可以问问看」都不再出现,
// 为猜这些问题烧的两处模型调用也一并省掉(见 useChatSuggestions / usePresetQuestions 的 enabled 短路)。

import { readPref, writePref } from '../../shared/localPrefs.ts'

export const CHAT_PREFS_KEY = 'atlas.chatPrefs'

export function loadChatSuggestionsOn(): boolean {
  // 没配过/存档坏了 = 默认开:第一次用的人需要有人教他聊天能干嘛
  const p = readPref<{ suggestionsOn?: unknown } | null>(CHAT_PREFS_KEY, null)
  return p === null || p.suggestionsOn !== false
}

export function saveChatSuggestionsOn(v: boolean): void {
  writePref(CHAT_PREFS_KEY, { suggestionsOn: v })
}
