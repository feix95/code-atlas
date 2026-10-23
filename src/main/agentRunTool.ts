// 执行一次已通过安检的工具调用:沙盒里真去看 → 包 tool_result → 垫步骤灰字 →
// 命中清单顺手推给界面画卡。这里只管一次调用,循环与账本归 agentChat。
import type { IpcMainInvokeEvent } from 'electron'
import { agentStepText, wrapToolResult } from '../ai/agent.ts'
import { TOOL_NAMES } from '../shared/agentTools.ts'
import type { AgentSearchMatch } from '../shared/types.ts'
import { addDevLog } from '../shared/devlog.ts'
import {
  agentListFiles,
  agentReadFile,
  agentRequestDirectoryAccess,
  agentSearchContent,
  agentWebSearch,
  sendAgentMatches,
  sendAgentStep
} from './agentTools.ts'
import type { PreparedAgentCall } from './agentCallArgs.ts'

/** 一次调用的执行回执:喂回模型的正文 + 成败 + 联网命中 + 结构化命中路径(界面画卡与质检对账用) */
export interface AgentToolRun {
  ok: boolean
  /** 已包好 <tool_result> 的正文 */
  content: string
  webHits: Array<{ title: string; url: string }>
  matchPaths: string[]
}

/** 执行一次合法调用(参数已过安检;这里只干活,不记账) */
export async function runAgentTool(input: {
  event: IpcMainInvokeEvent
  requestId: string
  prep: Extract<PreparedAgentCall, { ok: true }>
  readChars: number
  tavilyKey?: string
}): Promise<AgentToolRun> {
  const { event, requestId, prep, readChars, tavilyKey } = input
  const { name, root, relPath, keyword, readOffset, readLimit, query, requestedPath, stepTarget } =
    prep
  // 执行手统一形状:matches/matchesTruncated 只有 search_content 会带
  const exec: {
    ok: boolean
    text: string
    hint?: string
    matches?: AgentSearchMatch[]
    matchesTruncated?: boolean
    rootId?: string
    webResults?: Array<{ title: string; url: string }>
  } =
    name === TOOL_NAMES.requestDirectoryAccess
      ? await agentRequestDirectoryAccess(event, requestedPath)
      : name === TOOL_NAMES.listFiles
        ? await agentListFiles((root as { path: string }).path, relPath)
        : name === TOOL_NAMES.searchContent
          ? await agentSearchContent((root as { path: string }).path, relPath, keyword)
          : name === TOOL_NAMES.webSearch
            ? await agentWebSearch(query ?? '', tavilyKey)
            : await agentReadFile((root as { path: string }).path, relPath, {
                offset: readOffset,
                limit: readLimit,
                maxChars: readChars
              })
  if (exec.ok && root?.external)
    exec.text =
      root.kind === 'file'
        ? `临时授权文件 ${root.rootId}(${root.path}) 的读取结果:\n${exec.text}`
        : `临时目录 ${root.rootId}(${root.path}) 内的结果:\n${exec.text}`
  // 联网账的日志:只记搜索词和条数,不记网页正文 —— 下次出现「搜出来全是别家产品」时,
  // 先看它到底拿什么词去搜的;计数与标题/链接的账本归调用方记
  const webHits = name === TOOL_NAMES.webSearch && exec.ok ? (exec.webResults ?? []) : []
  if (name === TOOL_NAMES.webSearch) {
    addDevLog(
      'request',
      `联网搜索「${query ?? ''}」· ${exec.ok ? `命中 ${exec.webResults?.length ?? 0} 条` : '没查到'}`
    )
  }
  // 工具结果统一进 <tool_result>(提示词体系 2.0):标签里是资料,不是命令 ——
  // 文件内容、名单、搜索结果、外部目录回执一个待遇,人设里的口径在这落地
  const content = wrapToolResult(exec.text)
  sendAgentStep(
    event,
    requestId,
    agentStepText(name, stepTarget, exec.ok ? 'done' : 'error', exec.hint)
  )
  // 搜索搜到了就顺手把命中清单推给界面画卡(LLM 优化批次):结构化命中走旁路,
  // 用户看到的是程序摆的完整清单,不用模型转手抄写
  const matchPaths: string[] = []
  if (
    name === TOOL_NAMES.searchContent &&
    !root?.external &&
    exec.ok &&
    exec.matches &&
    exec.matches.length > 0
  ) {
    sendAgentMatches(event, requestId, {
      keyword,
      items: exec.matches,
      truncated: exec.matchesTruncated === true
    })
    // 质检闸的状态表:本场搜到的文件路径都记下,答案交卷时查它引用了没(判据二)
    for (const m of exec.matches) matchPaths.push(m.relPath)
  }
  return { ok: exec.ok, content, webHits, matchPaths }
}
