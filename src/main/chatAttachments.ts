// 聊天附件的记账与拼装:本轮的 @文件 + 之前带过的文件注记,截断的正文配上续读钥匙
// (拖入即授权换来的 rootId),再统一垫上「读到哪儿说到哪儿」的诚实注记。
import { agentDirectoryAccess } from './agentTools.ts'
import { sanitizeConversationId } from '../ai/chatSessions.ts'
import { buildFileMemoNote, createChatFileMemoStore } from '../ai/chatFileMemo.ts'
import { planFileAttachments, type ChatFileAttachment } from '../shared/chatFiles.ts'
import { buildFileAttachmentsText, READ_HONESTY_NOTE, type PlannedChatFile } from '../ai/index.ts'

/** 附件登记表:最近带过的文件附件记在内存里,下一轮垫成注记(详见 ai/chatFileMemo.ts) */
const chatFileMemo = createChatFileMemoStore()

/**
 * 拼出本轮附件块(null = 这轮一个附件也没有,也不给空块占额度)。
 * 附件登记表先取此前收过的文件注记垫在本轮资料前,再把这轮的附件记进账。
 */
export async function buildAttachmentBlock(input: {
  files: ChatFileAttachment[]
  conversationId: unknown
  ctxTokens: number
  replyTokens: number
  /** 人设 + 问题 + 联网资料 + 图片已占的额度,文件额度从剩下的里划 */
  otherTokens: number
  agentOn: boolean
}): Promise<string | null> {
  const memoConversationId = sanitizeConversationId(input.conversationId)
  const memoEntries = chatFileMemo
    .peek(memoConversationId)
    .filter((m) => !input.files.some((f) => f.name === m.name))
  const memoNote = buildFileMemoNote(memoEntries)
  let filesBlock: string | null = null
  if (input.files.length > 0) {
    const plan = planFileAttachments({
      ctxTokens: input.ctxTokens,
      replyTokens: input.replyTokens,
      otherTokens: input.otherTokens,
      files: input.files.map((f) => ({ text: f.text, totalLines: f.totalLines }))
    })
    // 拖入即授权:系统拖/选进来的文件凭它的绝对路径换本次运行的
    // 只读授权令牌,截断的正文就有续读的钥匙;拿不到授权令牌(文件没了/不是文件)就照实说,
    // 绝不开空头支票
    const plannedFiles: PlannedChatFile[] = []
    for (const [i, f] of input.files.entries()) {
      const granted = f.absPath ? await agentDirectoryAccess.grantFile(f.absPath) : null
      plannedFiles.push({
        ...f,
        text: plan[i].text,
        shownEndLine: plan[i].shownEndLine,
        truncated: plan[i].truncated,
        rootId: granted?.rootId
      })
    }
    chatFileMemo.update(
      memoConversationId,
      plannedFiles.map((f) => ({
        name: f.name,
        relPath: f.relPath,
        rootId: f.rootId,
        shownEndLine: f.shownEndLine,
        totalLines: f.totalLines
      }))
    )
    filesBlock = buildFileAttachmentsText(plannedFiles, { agentOn: input.agentOn })
  }
  const attachLayers = [memoNote, filesBlock].filter((x): x is string => x !== null)
  return attachLayers.length > 0 ? [...attachLayers, READ_HONESTY_NOTE].join('\n\n') : null
}
