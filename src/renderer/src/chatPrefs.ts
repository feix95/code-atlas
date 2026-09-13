// 聊天面板的偏好开关:存 localStorage(界面的事,每台机器自己一套,不进 AI 配置文件)。
// 第一条:聊天推荐问题 —— 关掉后聊天框上面那排「可以问问看」不再出现,
// 预测下一问的那次模型调用也一并省掉(见 useChatSuggestions 的 enabled 短路)。

export const CHAT_PREFS_KEY = 'atlas.chatPrefs'

export function loadChatSuggestionsOn(): boolean {
  try {
    const raw = localStorage.getItem(CHAT_PREFS_KEY)
    if (raw === null) return true // 没配过 = 默认开:第一次用的人需要有人教他聊天能干嘛
    const p = JSON.parse(raw) as { suggestionsOn?: unknown }
    return p.suggestionsOn !== false
  } catch {
    return true // 存档坏了就当没配过,回到默认,不炸界面
  }
}

export function saveChatSuggestionsOn(v: boolean): void {
  try {
    localStorage.setItem(CHAT_PREFS_KEY, JSON.stringify({ suggestionsOn: v }))
  } catch {
    // 存不进去就存不进去,开关这局还照常生效(内存里那份没丢)
  }
}
