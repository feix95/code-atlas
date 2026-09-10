// ── 第一百一十二锤:预览对话的推荐问题(规则层,纯函数)──
// 没聊过:按文件类别出题 —— 和概览页的预设问题同一个规矩(复用 presetQuestions 的类目表);
// 聊过一轮:换追问真言。AI 层没配/超时/出题不足时,这一层永远在场,永不空场。

import { rulePresetQuestions, type PresetFileInput } from './presetQuestions.ts'

/** 聊起来之后的追问真言:接得上话、点到要害,不空场 */
export const FOLLOW_UP_QUESTIONS = ['能举个例子吗？', '为什么要这么写？', '这里有什么坑？']

/** 规则层推荐(纯函数,自测覆盖):按「聊没聊过」分流 —— 聊了就追问,没聊就按文件出题 */
export function ruleChatSuggestions(hasTurn: boolean, file: PresetFileInput): string[] {
  return hasTurn ? FOLLOW_UP_QUESTIONS : rulePresetQuestions(file)
}
