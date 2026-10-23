// 模型喊的一次工具调用的「参数安检 + 目标解析」:合法就交出执行要用的全部字段,
// 不合法就交出一句人话原因,由调用方垫步骤灰字并把驳回喂回模型。
import type { AgentToolCall } from '../ai/agent.ts'
import { AGENT_READ_LIMIT_MAX, sanitizeAgentRelPath } from '../ai/agent.ts'
import { sanitizeWebFetchUrl, sanitizeWebQuery } from '../ai/weblookup.ts'
import { asToolName, TOOL_NAMES, type ToolName } from '../shared/agentTools.ts'
import { agentDirectoryAccess } from './agentTools.ts'
import { sanitizeExternalAbsPath } from './agentAccess.ts'

/** 解析后的授权根(project / 外部目录 / 外部文件) */
export type AgentSelectedRoot = ReturnType<typeof agentDirectoryAccess.resolve>

/** 翻页行数参数收编(宽松):数字/数字字符串都认,不合法就回保底 */
export function asLineCount(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(1, Math.trunc(v))
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Math.max(1, Number(v.trim()))
  return fallback
}

export type PreparedAgentCall =
  | {
      ok: true
      name: ToolName
      root: AgentSelectedRoot
      isFileTool: boolean
      relPath: string
      keyword: string
      readOffset: number
      readLimit: number
      query: string | null
      fetchUrl: string | null
      /** save_research_note 的正文与来源 */
      researchNote: string
      researchSource: string
      requestedPath: string | null
      /** 防打转记账键:工具名 + 目标(路径/关键词/搜索词/行号) */
      key: string
      /** 步骤灰字里展示的目标 */
      stepTarget: string
    }
  | { ok: false; name: ToolName | null; why: string; badTarget: string }

/** 这次调用是不是本地文件三件(要解析授权根、拼相对路径) */
export function isFileToolName(name: ToolName | null): boolean {
  return (
    name === TOOL_NAMES.readFile ||
    name === TOOL_NAMES.listFiles ||
    name === TOOL_NAMES.searchContent
  )
}

/** 参数不合法时给人看的原因(垫在步骤灰字里) */
function rejectWhy(name: ToolName | null, root: AgentSelectedRoot, queryMissing: boolean): string {
  if (!name) return '没有这个工具'
  if (isFileToolName(name) && root === null) return '目录编号无效或尚未获准,项目外目录要先申请'
  if (name === TOOL_NAMES.requestDirectoryAccess) return '要给用户明确点名的绝对文件夹路径(path)'
  if (name === TOOL_NAMES.webSearch)
    return queryMissing
      ? '要给搜索词(query),写概念词、软件名或短的公开问题'
      : '搜索词不合法:别把本地路径、代码或超长文字当搜索词,换几个公开的关键词再试'
  if (name === TOOL_NAMES.webFetch) return '要给公开网页地址(url),只收 http(s),别传本地路径'
  if (name === TOOL_NAMES.researchNote) return '要给一条关键事实(note),一句话说清'
  if (name === TOOL_NAMES.searchContent) return '要给关键词(keyword),如 500 或 DWELL_MS'
  return '路径不合法,要用所选根目录内的相对路径'
}

/** 一次调用的参数安检与目标解析(纯逻辑,只读沙盒授权表) */
export function prepareAgentCall(call: AgentToolCall, projectRoot: string): PreparedAgentCall {
  const name = asToolName(call.name)
  const isFileCall = isFileToolName(name)
  const root = isFileCall ? agentDirectoryAccess.resolve(projectRoot, call.args?.rootId) : null
  const relPath =
    name === TOOL_NAMES.webSearch ||
    name === TOOL_NAMES.webFetch ||
    name === TOOL_NAMES.researchNote ||
    name === TOOL_NAMES.requestDirectoryAccess
      ? ''
      : name === TOOL_NAMES.searchContent && call.args?.relPath === undefined
        ? ''
        : name === TOOL_NAMES.readFile && call.args?.relPath === undefined && root?.kind === 'file'
          ? ''
          : sanitizeAgentRelPath(call.args?.relPath)
  const keyword =
    name === TOOL_NAMES.searchContent && typeof call.args?.keyword === 'string'
      ? call.args.keyword.trim().slice(0, 200)
      : ''
  // read_file 的翻页参数(对齐 Claude Code 的 Read):1 起行号 + 行数,宽松收编
  const readOffset = name === TOOL_NAMES.readFile ? asLineCount(call.args?.offset, 1) : 1
  const readLimit =
    name === TOOL_NAMES.readFile
      ? asLineCount(call.args?.limit, AGENT_READ_LIMIT_MAX)
      : AGENT_READ_LIMIT_MAX
  const rawQuery = call.args?.query
  const requestedPath =
    name === TOOL_NAMES.requestDirectoryAccess ? sanitizeExternalAbsPath(call.args?.path) : null
  // web_search 的搜索词走自己的安检(隐私闸):空词/超长/带路径样的一律拒收
  const query = name === TOOL_NAMES.webSearch ? sanitizeWebQuery(rawQuery) : null
  const rawFetchUrl = call.args?.url
  const fetchUrl = name === TOOL_NAMES.webFetch ? sanitizeWebFetchUrl(rawFetchUrl) : null
  const researchNote =
    name === TOOL_NAMES.researchNote && typeof call.args?.note === 'string'
      ? call.args.note.trim().slice(0, 500)
      : ''
  const researchSource =
    name === TOOL_NAMES.researchNote && typeof call.args?.source === 'string'
      ? call.args.source.trim().slice(0, 200)
      : ''
  const queryMissing =
    name === TOOL_NAMES.webSearch && (typeof rawQuery !== 'string' || rawQuery.trim() === '')
  if (
    !name ||
    relPath === null ||
    (isFileCall && root === null) ||
    (name === TOOL_NAMES.searchContent && keyword === '') ||
    (name === TOOL_NAMES.requestDirectoryAccess && requestedPath === null) ||
    (name === TOOL_NAMES.webSearch && query === null) ||
    (name === TOOL_NAMES.webFetch && fetchUrl === null) ||
    (name === TOOL_NAMES.researchNote && researchNote === '')
  ) {
    const badTarget =
      name === TOOL_NAMES.webSearch
        ? String(rawQuery ?? '(没给搜索词)')
        : name === TOOL_NAMES.webFetch
          ? String(rawFetchUrl ?? '(没给地址)')
          : name === TOOL_NAMES.researchNote
            ? String(call.args?.note ?? '(没给要点)')
            : name === TOOL_NAMES.requestDirectoryAccess
              ? String(call.args?.path ?? '(没给目录)')
              : String(
                  call.args?.keyword ?? call.args?.relPath ?? call.args?.rootId ?? '(没给参数)'
                )
    return {
      ok: false,
      name,
      why: rejectWhy(name, root, queryMissing),
      badTarget
    }
  }
  // 防打转键:search 带上关键词、read_file 带上 offset(翻页读同一文件的下一段不是重复翻)、
  // web_search 带上搜索词 —— 同一范围搜「500」和「DWELL_MS」是两笔账
  const rootKey = root?.rootId ?? ''
  const key =
    name === TOOL_NAMES.searchContent
      ? `${name}:${rootKey}:${relPath}#${keyword}`
      : name === TOOL_NAMES.readFile
        ? `${name}:${rootKey}:${relPath}#${readOffset}`
        : name === TOOL_NAMES.webSearch
          ? `${name}:${query ?? ''}`
          : name === TOOL_NAMES.webFetch
            ? `${name}:${fetchUrl ?? ''}`
            : name === TOOL_NAMES.researchNote
              ? `${name}:${researchNote}`
              : name === TOOL_NAMES.requestDirectoryAccess
                ? `${name}:${requestedPath ?? ''}`
                : `${name}:${rootKey}:${relPath}`
  const stepTarget =
    name === TOOL_NAMES.searchContent
      ? keyword
      : name === TOOL_NAMES.webSearch
        ? (query ?? '')
        : name === TOOL_NAMES.webFetch
          ? (fetchUrl ?? '')
          : name === TOOL_NAMES.researchNote
            ? researchNote
            : name === TOOL_NAMES.requestDirectoryAccess
              ? (requestedPath ?? '')
              : relPath === ''
                ? root?.external
                  ? root.path
                  : '(项目根目录)'
                : relPath
  return {
    ok: true,
    name,
    root,
    isFileTool: isFileCall,
    relPath,
    keyword,
    readOffset,
    readLimit,
    query,
    fetchUrl,
    researchNote,
    researchSource,
    requestedPath,
    key,
    stepTarget
  }
}
