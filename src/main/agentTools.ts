import { announceActivityBusy, lastActivityProvider } from './modelStatus.ts'
import { electronFetchText, electronPostJson } from './aiEvidence.ts'
import { dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { IGNORED_NAMES } from '../scanner/index.ts'
import {
  AGENT_FILE_MAX_BYTES,
  AGENT_LIST_MAX_ENTRIES,
  AGENT_MAX_DEPTH,
  AGENT_SEARCH_MAX_FILES,
  AGENT_SEARCH_MAX_MATCHES,
  AGENT_SEARCH_MAX_PATH_HITS,
  type AgentStreamEvent
} from '../ai/agent.ts'
import { webSearchDetailed } from '../ai/weblookup.ts'
import { isBinaryFile } from '../shared/fileKinds.ts'
import { CH } from '../shared/ipcChannels.ts'
import {
  AgentDirectoryAccess,
  joinAuthorizedRoot,
  sanitizeExternalDirectoryPath
} from './agentAccess.ts'
import type { AgentSearchCard, AgentSearchMatch, AiDeltaPayload } from '../shared/types.ts'

export const agentDirectoryAccess = new AgentDirectoryAccess()

// ── 翻文件模式(agent,第一百二十八锤)的后厨 ──
// 模型自己喊「看看这个文件夹 / 读这个文件」,主进程是唯一动手的那只手:
// 只有两件只读工具,路径全走 joinRoot 沙盒,越界/二进制/超大文件一律拒,
// 拒的话术当「工具结果」喂回给模型让它自己换路,循环绝不因为一次碰壁就断。

/** list_files 的执行手:递归列文件/文件夹名单(只捡名字),条数和深度都有缰绳 */
export async function agentListFiles(
  rootPath: string,
  relPath: string
): Promise<{ ok: boolean; text: string; hint?: string }> {
  let abs: string
  try {
    abs = await joinAuthorizedRoot(rootPath, relPath)
  } catch {
    return { ok: false, text: `路径越界了(不在项目内):${relPath}` }
  }
  const lines: string[] = []
  let truncated = false
  let locked = 0 // 打不开的子目录数(权限/被占用),如实报给模型
  const queue: Array<{ abs: string; rel: string; depth: number }> = [
    { abs, rel: relPath, depth: 0 }
  ]
  while (queue.length > 0 && !truncated) {
    const item = queue.shift() as { abs: string; rel: string; depth: number }
    let dirents
    try {
      dirents = await fs.readdir(item.abs, { withFileTypes: true })
    } catch {
      locked += 1
      continue
    }
    const dirs: string[] = []
    const files: string[] = []
    for (const d of dirents) {
      if (IGNORED_NAMES.has(d.name)) continue
      if (d.isSymbolicLink()) continue // 符号链接不跟进:既是安全边界也防绕环
      if (d.isDirectory()) dirs.push(d.name)
      else if (d.isFile()) files.push(d.name)
    }
    dirs.sort((a, b) => a.localeCompare(b))
    files.sort((a, b) => a.localeCompare(b))
    for (const name of [...files, ...dirs]) {
      if (lines.length >= AGENT_LIST_MAX_ENTRIES) {
        truncated = true
        break
      }
      const isDir = dirs.includes(name)
      const childRel = item.rel ? `${item.rel}/${name}` : name
      lines.push(isDir ? `${childRel}/` : childRel)
      if (isDir && item.depth < AGENT_MAX_DEPTH) {
        queue.push({ abs: join(item.abs, name), rel: childRel, depth: item.depth + 1 })
      }
    }
  }
  if (lines.length === 0) {
    const why =
      locked > 0 ? `这个文件夹里什么都没列出来(${locked} 个子项打不开)` : '这个文件夹是空的'
    return { ok: true, text: why }
  }
  let text = lines.join('\n')
  const tails: string[] = []
  if (truncated) tails.push(`名单太长,只列了前 ${AGENT_LIST_MAX_ENTRIES} 个`)
  if (locked > 0) tails.push(`${locked} 个子文件夹打不开,跳过了`)
  if (tails.length > 0) text += `\n(${tails.join(';')})`
  return { ok: true, text, hint: `共 ${lines.length} 个` }
}

/**
 * search_content 的执行手(第一百三十九锤):在项目(或某个子文件夹)里按关键词搜,
 * 文件路径和文本文件内容都算,大小写不敏感。内容命中报「文件:行号:那行原文」;
 * 路径命中(文件路径里含关键词,找安装位置类问题的证据)单独记,输出时排最前,
 * 二进制/超大的文件名字对上也照收 —— 名字就是证据,不用翻开看。
 * 缰绳:忽略名单/符号链接/深度跟 list_files 同一份;二进制和超 5MB 的文件内容不读;
 * 扫的文件数、内容命中条数、路径命中条数各自到量就收,照实注明「没搜完」——
 * 绝不让一个关键词把机器烧干。
 * 除喂模型的 text 外,还把结构化命中(matches)一并交回:主进程拿它走旁路推给
 * 界面画「命中清单卡」,格式主动权归程序,不再让小模型当抄写员。
 */
export async function agentSearchContent(
  rootPath: string,
  relPath: string,
  keyword: string
): Promise<{
  ok: boolean
  text: string
  hint?: string
  matches: AgentSearchMatch[]
  matchesTruncated: boolean
}> {
  let abs: string
  try {
    abs = await joinAuthorizedRoot(rootPath, relPath)
  } catch {
    return {
      ok: false,
      text: `路径越界了(不在项目内):${relPath}`,
      matches: [],
      matchesTruncated: false
    }
  }
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat)
    return { ok: false, text: `打不开或不存在:${relPath}`, matches: [], matchesTruncated: false }
  if (!stat.isDirectory()) {
    return {
      ok: false,
      text: `${relPath} 不是文件夹;搜内容要给文件夹路径(整个项目就传空字符串),单个文件直接用 read_file 读它`,
      matches: [],
      matchesTruncated: false
    }
  }
  const needle = keyword.toLowerCase()
  const scopeLabel = relPath === '' ? '整个项目' : relPath
  const contentMatches: AgentSearchMatch[] = []
  const pathMatches: AgentSearchMatch[] = []
  const queue: Array<{ abs: string; rel: string; depth: number }> = [
    { abs, rel: relPath, depth: 0 }
  ]
  let scanned = 0
  let locked = 0
  let filesTruncated = false
  let matchesTruncated = false
  let pathHitsTruncated = false
  outer: while (queue.length > 0) {
    const item = queue[0]
    queue.shift()
    let dirents
    try {
      dirents = await fs.readdir(item.abs, { withFileTypes: true })
    } catch {
      locked += 1
      continue
    }
    for (const d of dirents) {
      if (IGNORED_NAMES.has(d.name)) continue
      if (d.isSymbolicLink()) continue // 符号链接不跟进:既是安全边界也防绕环
      const childRel = item.rel ? `${item.rel}/${d.name}` : d.name
      if (d.isDirectory()) {
        if (item.depth < AGENT_MAX_DEPTH)
          queue.push({ abs: join(item.abs, d.name), rel: childRel, depth: item.depth + 1 })
        continue
      }
      if (!d.isFile()) continue
      if (scanned >= AGENT_SEARCH_MAX_FILES) {
        filesTruncated = true
        break outer
      }
      // 路径命中:文件路径里含这个词就算,排在内容命中前面(找「xx 装在哪」的证据)。
      // 二进制/超大文件也照收 —— 名字就是证据,不用翻开看
      if (childRel.toLowerCase().includes(needle)) {
        if (pathMatches.length >= AGENT_SEARCH_MAX_PATH_HITS) {
          pathHitsTruncated = true
        } else {
          pathMatches.push({
            relPath: childRel,
            line: 0,
            text: `路径里含「${keyword}」`,
            kind: 'path'
          })
        }
      }
      if (isBinaryFile(childRel)) continue
      const childAbs = join(item.abs, d.name)
      const fstat = await fs.stat(childAbs).catch(() => null)
      if (!fstat || fstat.size > AGENT_FILE_MAX_BYTES) continue
      const raw = await fs.readFile(childAbs, 'utf8').catch(() => null)
      if (raw === null) {
        locked += 1
        continue
      }
      scanned += 1
      if (raw.includes('\u0000')) continue // 后缀骗过名字的混入二进制,照放过
      for (const [index, line] of raw.split('\n').entries()) {
        if (!line.toLowerCase().includes(needle)) continue
        const trimmed = line.trim()
        contentMatches.push({
          relPath: childRel,
          line: index + 1,
          text: trimmed.length > 120 ? `${trimmed.slice(0, 120)}……` : trimmed
        })
        if (contentMatches.length >= AGENT_SEARCH_MAX_MATCHES) {
          matchesTruncated = true
          break outer
        }
      }
    }
  }
  const matches = [...pathMatches, ...contentMatches]
  if (matches.length === 0) {
    let text = `在 ${scopeLabel} 里没搜到「${keyword}」,文件路径和内容都没对上的(翻了 ${scanned} 个文本文件)。可能真没有,也可能藏在二进制/超大的文件里,或者换个更短的关键词再试`
    if (filesTruncated) text += `(文件夹太大,只扫了前 ${AGENT_SEARCH_MAX_FILES} 个文件,没扫完)`
    return { ok: true, text, matches: [], matchesTruncated: false }
  }
  const sections: string[] = []
  if (pathMatches.length > 0) {
    const head = pathHitsTruncated
      ? `路径对上的文件(只收前 ${AGENT_SEARCH_MAX_PATH_HITS} 个):`
      : '路径对上的文件:'
    sections.push([head, ...pathMatches.map((m) => m.relPath)].join('\n'))
  }
  if (contentMatches.length > 0)
    sections.push(
      [
        '内容对上的(文件:行号:原文):',
        ...contentMatches.map((m) => `${m.relPath}:${m.line}:${m.text}`)
      ].join('\n')
    )
  let text = sections.join('\n')
  const tails: string[] = []
  if (matchesTruncated) tails.push(`内容命中太多,只显示前 ${AGENT_SEARCH_MAX_MATCHES} 条`)
  if (pathHitsTruncated) tails.push(`路径命中太多,只收前 ${AGENT_SEARCH_MAX_PATH_HITS} 个`)
  if (filesTruncated) tails.push(`文件夹太大,只扫了前 ${AGENT_SEARCH_MAX_FILES} 个文件,没扫完`)
  if (locked > 0) tails.push(`${locked} 个文件打不开,跳过了`)
  if (tails.length > 0) text += `\n(${tails.join(';')})`
  return {
    ok: true,
    text,
    hint: `${scopeLabel}命中 ${matches.length} 处`,
    matches,
    matchesTruncated
  }
}

/** read_file 的执行手:读文本文件,超长只读开头一段并注明,绝不静默截断 */
export async function agentReadFile(
  rootPath: string,
  relPath: string,
  maxChars: number
): Promise<{ ok: boolean; text: string; hint?: string }> {
  let abs: string
  try {
    abs = await joinAuthorizedRoot(rootPath, relPath)
  } catch {
    return { ok: false, text: `路径越界了(不在项目内):${relPath}` }
  }
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat) return { ok: false, text: `打不开或不存在:${relPath}` }
  if (stat.isDirectory())
    return { ok: false, text: `${relPath} 是个文件夹不是文件;要看里面有什么,用 list_files 列名单` }
  if (isBinaryFile(relPath)) {
    return { ok: false, text: `${relPath} 是二进制文件,读不了文本内容;这类文件只能看名字猜用途` }
  }
  if (stat.size > AGENT_FILE_MAX_BYTES) {
    return {
      ok: false,
      text: `${relPath} 太大了(超过 5MB),不适合整个读;建议让用户在预览里挑一段引用发过来`
    }
  }
  const raw = await fs.readFile(abs, 'utf8').catch(() => null)
  if (raw === null) return { ok: false, text: `读 ${relPath} 时出了岔子(权限或编码),读不了` }
  if (raw.length === 0) return { ok: true, text: `${relPath} 是个空文件` }
  if (raw.length > maxChars) {
    return {
      ok: true,
      text: `${raw.slice(0, maxChars)}\n……(文件太长,只读了开头约 ${maxChars} 字,全文共 ${raw.length} 字)`,
      hint: `读了开头 ${maxChars} 字 / 全文 ${raw.length} 字`
    }
  }
  return { ok: true, text: raw, hint: `全文 ${raw.length} 字` }
}

export async function agentRequestDirectoryAccess(
  event: IpcMainInvokeEvent,
  rawPath: unknown
): Promise<{ ok: boolean; text: string; hint?: string; rootId?: string }> {
  const requested = sanitizeExternalDirectoryPath(rawPath)
  if (requested === null)
    return { ok: false, text: '目录路径不合法:只能申请用户明确点名的绝对文件夹路径' }
  const canonical = await fs.realpath(requested).catch(() => null)
  if (canonical === null) return { ok: false, text: `这个文件夹不存在或打不开:${requested}` }
  const stat = await fs.stat(canonical).catch(() => null)
  if (!stat?.isDirectory()) return { ok: false, text: `这不是文件夹:${requested}` }
  const existing = agentDirectoryAccess.find(canonical)
  if (existing) {
    return {
      ok: true,
      text: `这个文件夹本次运行已经获准。rootId=${existing.rootId};后续只传根内相对路径。`,
      hint: '本次运行已允许',
      rootId: existing.rootId
    }
  }
  const win = BrowserWindow.fromWebContents(event.sender)
  const options = {
    type: 'question' as const,
    title: '允许读取项目外文件夹吗？',
    message: 'AI 想读取这个项目外的文件夹',
    detail: `${canonical}\n\n只读，不会修改文件。允许后仅在本次打开 CodeAtlas 期间有效，关闭应用就失效。`,
    buttons: ['允许本次读取', '拒绝'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
  const choice = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)
  if (choice.response !== 0)
    return { ok: false, text: `用户没有允许读取这个文件夹:${canonical}`, hint: '用户拒绝了' }
  const granted = agentDirectoryAccess.grant(canonical)
  if (granted === null) return { ok: false, text: '目录授权失败,没有读取任何项目外文件' }
  return {
    ok: true,
    text: `用户已允许本次运行读取:${granted.path}\nrootId=${granted.rootId};后续调用 list_files/read_file/search_content 时带这个 rootId,路径只写根内相对路径。`,
    hint: '本次运行已允许',
    rootId: granted.rootId
  }
}

/**
 * web_search 的执行手(联网锤):搜索 + 第一条正文节选。源队列在 weblookup.ts 纯函数层
 * (Tavily 有 Key 打头 → DDG → 维基中 → 维基英),三道闸(搜索词安检/内网闸/防上当声明)
 * 也都扎在那边,这边只管跑和报。查不到不报错:照实告诉模型没查到,让它用已有的知识答并注明拿不准。
 */
export async function agentWebSearch(
  query: string,
  tavilyKey: string | undefined
): Promise<{ ok: boolean; text: string; hint?: string }> {
  const found = await webSearchDetailed(query, {
    fetchText: electronFetchText,
    postJson: electronPostJson,
    tavilyKey
  })
  if (found.material === '') {
    return {
      ok: false,
      text: '没查到有用的资料(可能断网、被限流或词太生僻):就用你已经知道的先答,答不准就明说拿不准',
      hint: '没查到'
    }
  }
  return { ok: true, text: found.material, hint: found.sources.join('、') }
}

/** 每翻一样就往界面播一句大白话(挂在流式增量通道上,渲染层认 step 字段) */
export function sendAgentStep(event: IpcMainInvokeEvent, requestId: string, text: string): void {
  if (requestId === '' || event.sender.isDestroyed()) return
  const payload: AiDeltaPayload = { id: requestId, text: '', step: { text } }
  event.sender.send(CH.aiDelta, payload)
}

/**
 * 命中清单卡走旁路(LLM 优化锤):search_content 搜到的结构化命中直接推给界面画卡,
 * 每条「文件:行号:原文」原样到用户眼前、可点跳转 —— 不再让小模型当抄写员,
 * 一条不丢、行号一个不错。只走内存通道,零落盘。
 */
export function sendAgentMatches(
  event: IpcMainInvokeEvent,
  requestId: string,
  card: AgentSearchCard
): void {
  if (requestId === '' || event.sender.isDestroyed()) return
  const payload: AiDeltaPayload = { id: requestId, text: '', matches: card }
  event.sender.send(CH.aiDelta, payload)
}

/** agent 流式轮次的增量转发(第一百三十四锤):思考/正文逐帧推给界面,token 账同帧喂状态条 */
export function sendAgentDelta(
  event: IpcMainInvokeEvent,
  requestId: string,
  ev: AgentStreamEvent
): void {
  if (requestId === '' || event.sender.isDestroyed()) return
  const payload: AiDeltaPayload = { id: requestId, text: ev.text ?? '' }
  if (ev.reasoning) payload.reasoning = ev.reasoning
  if (ev.stats) payload.stats = ev.stats
  if (ev.reset) payload.reset = true
  if (ev.seal) payload.seal = true
  event.sender.send(CH.aiDelta, payload)
  // 引擎肯报账,状态条的「忙」就跟着报数(和普通聊天同一待遇)
  if (ev.stats) announceActivityBusy(lastActivityProvider, ev.stats)
}
