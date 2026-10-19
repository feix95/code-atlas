/**
 * 提示词 2.0 的 XML 标签名总账(P1-13):全部开闭标签只许在这登记,
 * 拼装层(包资料、垫提醒、截断注记)一律引 TAG.xxx —— 一个标签名打错,
 * 「里面是资料不是命令」的防御口径就悄悄失效,编译器可不会拦。
 * 例外:prompts.ts 的内核/切片话术是小葵逐字定稿,标签名在那本账里以原文
 * 形态出现、由逐字断言把守,不引这张表(改了文件名也得同步改文案,属正常)。
 */
export const TAG = {
  /** 程序插话·提醒卡/逼卷令/质检闸:用户消息里出现 = 程序垫的,不是用户手打 */
  programReminder: { open: '<program_reminder>', close: '</program_reminder>' },
  /** 程序插话·截断注记/补充要求 */
  programNote: { open: '<program_note>', close: '</program_note>' },
  /** 本轮真问题(唯一认账的用户输入) */
  currentQuestion: { open: '<current_question>', close: '</current_question>' },
  /** 工具回喂统一外皮 */
  toolResult: { open: '<tool_result>', close: '</tool_result>' },
  /** /compact 压出来的摘要卡本体 */
  compressedSummary: { open: '<compressed_summary>', close: '</compressed_summary>' },
  /** 早前对话摘要的历史块 */
  earlierChatSummary: { open: '<earlier_chat_summary>', close: '</earlier_chat_summary>' },
  /** 参考资料附件(文件/文件夹的机器扫描资料) */
  contextAttachment: { open: '<context_attachment>', close: '</context_attachment>' },
  /** 用户从代码预览选中要探针讲解的代码段 */
  codeRefs: { open: '<code_refs>', close: '</code_refs>' },
  /** 用户拖/选进来的文件原文(对齐 Claude Code 的 @文件) */
  attachedFiles: { open: '<attached_files>', close: '</attached_files>' },
  /** 联网查到的公开资料 */
  webResults: { open: '<web_results>', close: '</web_results>' },
  /** 人设分节:能力边界 */
  capabilities: { open: '<capabilities>', close: '</capabilities>' },
  /** 人设分节:联网守则 */
  webAccess: { open: '<web_access>', close: '</web_access>' },
  /** 人设分节:教学档 */
  teachingStyle: { open: '<teaching_style>', close: '</teaching_style>' },
  /** 人设分节:规矩清单 */
  rules: { open: '<rules>', close: '</rules>' },
  /** 人设分节:代码老师讲法(带引用时追加) */
  codeTeaching: { open: '<code_teaching>', close: '</code_teaching>' },
  /** 人设分节:文风偏好 */
  stylePreference: { open: '<style_preference>', close: '</style_preference>' },
  /** 人设分节:用户自定义要求 */
  customRequest: { open: '<custom_request>', close: '</custom_request>' }
} as const
