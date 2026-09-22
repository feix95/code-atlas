// ── AI 默认值 ──
// 内置模型没在设置里手填「模型上下文」时用的默认窗口:主进程喂给引擎(-c)、AI 层按比例
// 算预算、设置页的提示语,三边共用一个数,免得各写各的、哪天改漏一处互相打架。
// 主进程和渲染层都要读,所以住在 shared。

/** 上下文窗口默认大小(tokens):设置里留空时的兜底,也是内置引擎 -c 的默认值 */
export const DEFAULT_CONTEXT_SIZE = 16384

/** 模型上下文的合法下限(tokens):读档校验、档位对账、自动探测的合格线,都从它起 */
export const CONTEXT_SIZE_MIN = 512
/** 模型上下文的合法上限(tokens):设置页输入框的封顶 */
export const CONTEXT_SIZE_MAX = 1_048_576

/**
 * 上下文档位的归一化(纯函数):喂引擎 -c、对账「档位改了没」、启动记账,都认这个数 ——
 * 最小 512 + 取整。以前同一表达式散写七处,改一处漏一处账就对不上。
 */
export function normalizeContextSize(contextSize: number): number {
  return Math.max(CONTEXT_SIZE_MIN, Math.floor(contextSize))
}

/** 等响应头的耐心(毫秒):模型加载/排队可能很久,大提示词预处理可能整段静默 ——
 *  普通聊天和 agent 同一口径;首帧之后由流式看门狗自己接管 */
export const AI_HEADERS_TIMEOUT_MS = 120_000

/** 聊天请求的采样温度:讲解类任务要稳不要飘,普通聊天和 agent 同一口径 */
export const CHAT_TEMPERATURE = 0.2

/** 附件资料正文上限(字):自由对话的证据从简,别把模型的上下文挤爆 ——
 *  渲染层整理附件时按它截,主进程洗附件时按它验,一把尺 */
export const ATTACHMENT_DETAILS_MAX = 4000

/** LM Studio 默认服务地址:配置出厂值、输入框占位提示、状态探测兜底,三处同一个 */
export const DEFAULT_LMSTUDIO_BASE_URL = 'http://127.0.0.1:1234/v1'

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

/**
 * 反重复采样参数(第一百四十三锤,复读机防线):内置引擎的请求体原样带上。
 * repeat_penalty/repeat_last_n 是传统的「说过的词降权」;dry_* 是 DRY 采样,
 * 专治「同一个短语无限循环」—— 序列说到第三遍开始罚,越滚罚得越重(指数级)。
 * 只对内置引擎发:外接服务的采样旋钮在它们自己界面里管,咱们不越权,行为一分不变;
 * 引擎版本老不认这些字段也只是安静忽略,零风险。
 */
export const AI_ANTI_REPEAT_PARAMS = {
  repeat_penalty: 1.1,
  repeat_last_n: 256,
  dry_multiplier: 0.8,
  dry_base: 1.75,
  dry_allowed_length: 2
} as const
