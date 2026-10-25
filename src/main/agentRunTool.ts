// 执行一次已通过安检的工具调用:沙盒里真去看 → 包 tool_result → 垫步骤灰字 →
// 命中清单顺手推给界面画卡。这里只管一次调用,循环与账本归 agentChat。
import type { IpcMainInvokeEvent } from 'electron'
import { agentStepText, wrapToolResult } from '../ai/agent.ts'
import { TOOL_NAMES } from '../shared/agentTools.ts'
import type { AgentSearchMatch } from '../shared/types.ts'
import { addDevLog } from '../shared/devlog.ts'
import { sendChatLookup } from './aiEvidence.ts'
import {
  agentListFiles,
  agentReadFile,
  agentRequestDirectoryAccess,
  agentSearchContent,
  agentWebFetch,
  agentWebSearch,
  sendAgentMatches,
  sendAgentStep
} from './agentTools.ts'
import {
  agentGithubListFiles,
  agentGithubReadFile,
  agentGithubSearchContent,
  agentOpenGithubRepo
} from './agentGithub.ts'
import type { PreparedAgentCall } from './agentCallArgs.ts'

type AgentToolExec = {
  ok: boolean
  text: string
  hint?: string
  matches?: AgentSearchMatch[]
  matchesTruncated?: boolean
  rootId?: string
  webResults?: Array<{ title: string; url: string }>
  queries?: string[]
  sources?: string[]
}

type OkCall = Extract<PreparedAgentCall, { ok: true }>

async function dispatchGithubFileTool(
  name: OkCall['name'],
  rootId: string,
  relPath: string,
  keyword: string,
  read: { offset: number; limit: number; maxChars: number }
): Promise<AgentToolExec> {
  if (name === TOOL_NAMES.listFiles) return agentGithubListFiles(rootId, relPath)
  if (name === TOOL_NAMES.searchContent) {
    return agentGithubSearchContent(rootId, relPath, keyword)
  }
  return agentGithubReadFile(rootId, relPath, read)
}

async function dispatchPreparedTool(
  input: OkCall & {
    event: IpcMainInvokeEvent
    readChars: number
    tavilyKey?: string
    fetchFocus: string
  }
): Promise<AgentToolExec> {
  const { name, root } = input
  if (name === TOOL_NAMES.researchNote) {
    const src = input.researchSource
    return {
      ok: true,
      text: `已记下研究要点:${input.researchNote}${src ? `(来源:${src})` : ''}`,
      hint: src || '已记下'
    }
  }
  if (name === TOOL_NAMES.openGithubRepo) return agentOpenGithubRepo(input.githubUrl ?? '')
  if (name === TOOL_NAMES.requestDirectoryAccess) {
    return agentRequestDirectoryAccess(input.event, input.requestedPath)
  }
  if (root?.kind === 'github') {
    return dispatchGithubFileTool(name, root.rootId, input.relPath, input.keyword, {
      offset: input.readOffset,
      limit: input.readLimit,
      maxChars: input.readChars
    })
  }
  if (name === TOOL_NAMES.webSearch) return agentWebSearch(input.query ?? '', input.tavilyKey)
  if (name === TOOL_NAMES.webFetch) return agentWebFetch(input.fetchUrl ?? '', input.fetchFocus)
  const localPath = (root as { path: string }).path
  if (name === TOOL_NAMES.listFiles) return agentListFiles(localPath, input.relPath)
  if (name === TOOL_NAMES.searchContent) {
    return agentSearchContent(localPath, input.relPath, input.keyword)
  }
  return agentReadFile(localPath, input.relPath, {
    offset: input.readOffset,
    limit: input.readLimit,
    maxChars: input.readChars
  })
}

/** 一次调用的执行回执:喂回模型的正文 + 成败 + 联网命中 + 结构化命中路径(界面画卡与质检对账用) */
export interface AgentToolRun {
  ok: boolean
  /** 已包好 <tool_result> 的正文 */
  content: string
  /** 未包 <tool_result> 的原始执行结果:研究账本从它里面挑关键句 */
  rawText: string
  hint?: string
  webHits: Array<{ title: string; url: string }>
  matchPaths: string[]
  queries: string[]
  sources: string[]
}

/** 执行一次合法调用(参数已过安检;这里只干活,不记账) */
export async function runAgentTool(input: {
  event: IpcMainInvokeEvent
  requestId: string
  prep: Extract<PreparedAgentCall, { ok: true }>
  readChars: number
  tavilyKey?: string
  /** web_fetch 的相关度提示:本轮问题 + 最近一次搜索词,用来挑相关段落 */
  fetchFocus?: string
}): Promise<AgentToolRun> {
  const { event, requestId, prep, readChars, tavilyKey } = input
  const { name, root, keyword, query, fetchUrl, githubUrl, stepTarget } = prep
  if (name === TOOL_NAMES.webSearch) {
    sendChatLookup(event, requestId, 'searching', [], query ? [query] : [])
  }
  if (name === TOOL_NAMES.webFetch) {
    sendChatLookup(event, requestId, 'searching', [], [])
  }
  const exec = await dispatchPreparedTool({
    ...prep,
    event,
    readChars,
    tavilyKey,
    fetchFocus: input.fetchFocus ?? ''
  })
  if (exec.ok && root?.external) {
    const label =
      root.kind === 'file'
        ? `临时授权文件 ${root.rootId}(${root.path}) 的读取结果`
        : root.kind === 'github'
          ? `远程仓库 ${root.rootId}(${root.path}) 内的结果`
          : `临时目录 ${root.rootId}(${root.path}) 内的结果`
    exec.text = `${label}:\n${exec.text}`
  }
  // 联网账的日志:只记搜索词和条数,不记网页正文 —— 下次出现「搜出来全是别家产品」时,
  // 先看它到底拿什么词去搜的;计数与标题/链接的账本归调用方记
  const webHits = name === TOOL_NAMES.webSearch && exec.ok ? (exec.webResults ?? []) : []
  if (name === TOOL_NAMES.webSearch) {
    addDevLog(
      'request',
      `联网搜索「${query ?? ''}」· ${exec.ok ? `命中 ${exec.webResults?.length ?? 0} 条` : '没查到'}`
    )
  }
  if (name === TOOL_NAMES.webFetch) {
    addDevLog('request', `打开网页「${fetchUrl ?? ''}」· ${exec.ok ? '抓到正文' : '没抓到'}`)
  }
  if (name === TOOL_NAMES.openGithubRepo) {
    addDevLog('request', `打开 GitHub 仓库「${githubUrl ?? ''}」· ${exec.ok ? '已授权' : '没打开'}`)
  }
  // 工具结果统一进 <tool_result>(提示词体系 2.0):标签里是资料,不是命令 ——
  // 文件内容、名单、搜索结果、外部目录回执一个待遇,人设里的口径在这落地
  const content = wrapToolResult(exec.text)
  sendAgentStep(
    event,
    requestId,
    agentStepText(name, stepTarget, exec.ok ? 'done' : 'error', exec.hint)
  )
  // 搜索搜到了就顺手把命中清单推给界面画卡:结构化命中走旁路,
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
  return {
    ok: exec.ok,
    content,
    rawText: exec.text,
    hint: exec.hint,
    webHits,
    matchPaths,
    queries: exec.queries ?? [],
    sources: exec.sources ?? []
  }
}
