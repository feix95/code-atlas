// Wiki 语种改动的广播:生成弹窗与设置页保存语种后喊一声,
// 图谱上已显示的 AI 名称与侧栏说明不用重开页签就能跟上当前语种。
const LANGUAGE_EVENT = 'atlas:wiki-language-changed'

export function notifyWikiLanguageChanged(): void {
  window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT))
}

export function onWikiLanguageChanged(listener: () => void): () => void {
  window.addEventListener(LANGUAGE_EVENT, listener)
  return () => window.removeEventListener(LANGUAGE_EVENT, listener)
}
