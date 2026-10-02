// 立项问卷 → 内置 agent 的桥(§3.6 路径二):问卷住在 uiframe 签里,chat 与页签开关在 App 层;
// 用一个小事件通道递话,App 注册监听后切 chat 签并把立项单发出去。
const listeners = new Set<(text: string) => void>()

export function onQuizAgentRequest(l: (text: string) => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function requestQuizAgent(text: string): void {
  for (const l of listeners) l(text)
}
