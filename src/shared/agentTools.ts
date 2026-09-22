/**
 * agent 工具名总账(P1-14):五个工具的名字只许在这登记 ——
 * 定义(OpenAI tools 表)、分发(主进程 call.name 判派)、文案(agentStepText)、
 * 类型(ToolName)四层全引这里。改名一处生效;写错名编译器当场拦,
 * 不再让工具静默变「不认识」。
 */
export const TOOL_NAMES = {
  listFiles: 'list_files',
  readFile: 'read_file',
  searchContent: 'search_content',
  requestDirectoryAccess: 'request_directory_access',
  webSearch: 'web_search'
} as const

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES]

/** 模型喊回来的名字 → 户口本上的名字;不认识的回 null(主进程按「没有这个工具」拒) */
export function asToolName(name: string): ToolName | null {
  return (Object.values(TOOL_NAMES) as string[]).includes(name) ? (name as ToolName) : null
}

/**
 * 每个工具的界面播报词(agentStepText 的原料):翻什么的动词 + 名词尾巴 + 重复/出错的措辞。
 * 词表和名字同桌吃饭,改文案不用进三元巨链里翻。
 */
export const TOOL_STEP_WORDS: Record<
  ToolName,
  { verb: string; /** done 句尾的名词(「翻了 xx 的内容」) */ what: string; repeat: string; error: string }
> = {
  [TOOL_NAMES.listFiles]: { verb: '翻了', what: '的文件名单', repeat: '刚才已经看过了,不用再翻', error: '看不了' },
  [TOOL_NAMES.readFile]: { verb: '读了', what: '的内容', repeat: '刚才已经看过了,不用再翻', error: '看不了' },
  [TOOL_NAMES.searchContent]: { verb: '搜了', what: '', repeat: '刚才已经看过了,不用再翻', error: '看不了' },
  [TOOL_NAMES.requestDirectoryAccess]: { verb: '申请读取了', what: '', repeat: '刚才已经申请过了', error: '没有获准读取' },
  [TOOL_NAMES.webSearch]: { verb: '上网查了', what: '', repeat: '刚才已经查过了,不用再查', error: '查不了' }
}
