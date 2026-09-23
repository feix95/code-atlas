// AI 人话解释器:把文件的结构 + 关系,交给本地大模型翻译成普通人都懂的话。
// 路径契约:只认 relPath,读文件是主进程的事;这里只负责"拼提示词 + 调接口"。
// 底层不绑定任何推理服务 —— LM Studio、llama-server 都说 OpenAI 兼容的方言,
// 这里只认 ChatTarget(baseURL + 模型名),换后端不改一行业务代码。
// 拆分后这里只留出口:实现按域分进同目录子模块,老调用方照旧从这里进。

/**
 * 「试一句」的固定人设与题目(第一百一十三锤):设置页里改完说话方式,当场听一遍效果。
 * 挑一段极小的代码当题目 —— 一口气能听出语气、要不要分点、用不用表情三件事。
 */
export const STYLE_SAMPLE_SYSTEM =
  '你是 Code Atlas 的代码讲解员,用中文讲清楚用户给你的代码在干什么。'
export const STYLE_SAMPLE_QUESTION = '讲讲这一段:\nfor (const f of files) {\n  await readFile(f)\n}'

/** 拿不到真实上下文时的默认:和内置引擎的默认窗口同一个数(数住在 shared/aiDefaults),转出去给老调用方 */
export { DEFAULT_CONTEXT_SIZE } from '../shared/aiDefaults.ts'

// 「上下文装不下」嗅探 + HTTP 错误人话翻译的户口搬进了 ai/http.ts(请求底座批);
// 转一手 re-export,老朋友(main/自测)照旧从这里进
export { isContextOverflow, friendlyHttpError } from './http.ts'
export { estimateTokens } from '../shared/aiText.ts'

export * from './chat.ts'
export * from './contextProbe.ts'
export * from './explain.ts'
export * from './explainPrompt.ts'
export * from './gitPrompts.ts'
export * from './guessPrompts.ts'
export * from './locate.ts'
export * from './webPrompts.ts'
