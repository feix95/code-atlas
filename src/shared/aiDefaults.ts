// ── AI 默认值 ──
// 内置模型没在设置里手填「模型上下文」时用的默认窗口:主进程喂给引擎(-c)、AI 层按比例
// 算预算、设置页的提示语,三边共用一个数,免得各写各的、哪天改漏一处互相打架。
// 主进程和渲染层都要读,所以住在 shared。

/** 上下文窗口默认大小(tokens):设置里留空时的兜底,也是内置引擎 -c 的默认值 */
export const DEFAULT_CONTEXT_SIZE = 16384

/** 一轮对话最多引用几段代码:再多模型也讲不细,还把上下文挤没了 */
export const CODE_REFS_MAX = 6

/** 单段引用的字数上限:引用是「一段」,不是整个文件 */
export const CODE_REF_CHARS_MAX = 2000

/** 一轮里所有引用的字数上限:几段加起来也不能把上下文吃光(动态账的保底地面) */
export const CODE_REFS_TOTAL_CHARS_MAX = 6000

/**
 * 一轮引用总量的天花板(动态账的顶,第一百二十六锤):额度跟着用户的上下文窗口
 * 动态算,但锅再大也不超这个数 —— 喂太饱,小模型会懵。
 */
export const CODE_REFS_TOTAL_CHARS_CEILING = 12000

/**
 * 思考模式的额外字数额度(tokens,第一百一十五锤):开了思考,模型回答前会先写
 * 一大段推理,这段推理也算在 max_tokens 里 —— 不加额度,思考就把回答的字数吃光,
 * 正文一个字都不剩(小葵的 Qwen3.5 就是这么「一句没回」的)。
 */
export const THINKING_EXTRA_TOKENS = 2048
