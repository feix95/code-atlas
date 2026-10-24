import { userDataDir } from './paths.ts'
import { announceActivityIdle } from './modelStatus.ts'
import {
  electronFetchText,
  electronPostJson,
  explainAborters,
  explainWithCancel,
  makeDeltaSender,
  resolveChatTargetOrError,
  sendResetDelta
} from './aiEvidence.ts'
import { runAgentChat } from './agentChat.ts'
import { rememberAgentTurn } from './chatMemory.ts'
import { buildCompactMessages, sanitizeCompactHistory } from '../shared/compact.ts'
import {
  explainWithModel,
  explainWithMessages,
  isContextOverflow,
  STYLE_SAMPLE_SYSTEM,
  STYLE_SAMPLE_QUESTION
} from '../ai/index.ts'
import { webLookup } from '../ai/weblookup.ts'
import { loadAiConfig } from '../ai/config.ts'
import { joinRoot } from '../shared/paths.ts'
import {
  buildPersonalizationPrompt,
  sanitizePersonalization,
  withPersonalization
} from '../shared/personalization.ts'
import { prepareChat } from './chatContext.ts'
import { CH } from '../shared/ipcChannels.ts'
import { clipboard, ipcMain, shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import type { AiChatResult, AiExplainResult } from '../shared/types.ts'

export function registerChatIpc(): void {
  // 自由对话:独立通道、独立人设(Atlas 小探针)。当前选中对象的资料以「附件」身份
  // 垫在最前面,仅供参考,不进历史 —— 换对象不带旧资料,旧对话也不污染新对象。
  // 用户点名要联网(联网/搜搜/查查…)且开关开着,程序先按名字真查一份资料再开答;
  // 查询的每一步状态(查着了/没查到/没开开关)都以程序状态表为准回传,模型说了不算。
  // 装配那一大摊(附件/图片/联网/预算/历史)住 chatContext,这里只管流程。
  ipcMain.handle(CH.aiChat, async (event, req: unknown): Promise<AiChatResult> => {
    const startedAt = Date.now()
    const body = (typeof req === 'object' && req !== null ? req : {}) as Record<string, unknown>
    const prepared = await prepareChat(event, body, startedAt)
    if (!prepared.ok) return prepared.result
    const { prep } = prepared
    // 翻文件模式(agent):开关开着就走工具循环 —— 模型自己喊看哪,
    // 主进程沙盒里翻给它看;rootPath 是沙盒的墙,没带或不对就老实说翻不了
    if (prep.agentOn) {
      if (prep.agentRoot === '') {
        return {
          status: 'error',
          text: '翻文件模式得先打开一个项目才有得翻:关掉「翻文件」开关,或先在左边打开项目再问',
          model: '',
          durationMs: Date.now() - startedAt,
          webLookup: prep.meta
        }
      }
      const aborter = new AbortController()
      if (prep.requestId !== '') explainAborters.set(prep.requestId, aborter)
      try {
        return await runAgentChat({
          event,
          requestId: prep.requestId,
          target: prep.resolved.target,
          systemPrompt: prep.systemPrompt,
          baseMessages: prep.assembleMessages(prep.memory.planned.messages),
          rootPath: prep.agentRoot,
          ctx: prep.resolved.ctx,
          replyCap: prep.cap,
          allowThinking: prep.thinking,
          signal: aborter.signal,
          startedAt,
          webLookup: prep.meta,
          webSearchEnabled: prep.resolved.webLookup === true,
          tavilyKey: prep.resolved.tavilyKey,
          onTurnComplete: (trace, answer) =>
            rememberAgentTurn(prep.memory, prep.question, trace, answer)
        })
      } finally {
        if (prep.requestId !== '') explainAborters.delete(prep.requestId)
        if (explainAborters.size === 0) announceActivityIdle()
      }
    }
    const aborter = new AbortController()
    if (prep.requestId !== '') explainAborters.set(prep.requestId, aborter)
    try {
      const streamOpts = {
        allowThinking: prep.thinking,
        onRestart: () => sendResetDelta(event, prep.requestId)
      }
      let res = await explainWithMessages(
        prep.resolved.target,
        prep.assembleMessages(prep.plainHistory),
        makeDeltaSender(event, prep.requestId),
        aborter.signal,
        prep.cap,
        streamOpts
      )
      // 上下文爆了的自动救援(自动压缩那案):服务拒收时模型一个字没吐,把旧聊天史砍到最近 2 条重试一轮;
      // 只兜一次,再爆就照实给指路话,不跟它无限耗
      if (res.status === 'error' && isContextOverflow(res.text)) {
        sendResetDelta(event, prep.requestId)
        res = await explainWithMessages(
          prep.resolved.target,
          prep.assembleMessages(prep.plainHistory.slice(-2)),
          makeDeltaSender(event, prep.requestId),
          aborter.signal,
          prep.cap,
          streamOpts
        )
        if (res.status === 'error' && isContextOverflow(res.text)) {
          res = {
            ...res,
            text: '这段对话把模型的上下文撑爆了(已经自动清掉旧聊天重试过还是不行):点「新对话」轻装上阵,或者把模型的上下文调大再来。'
          }
        }
      }
      // 用户主动掐掉(经 atlas:ai-cancel):如实记 cancelled,不算模型出错
      const status = aborter.signal.aborted ? 'cancelled' : res.status
      return { ...res, status, webLookup: prep.meta }
    } finally {
      if (prep.requestId !== '') explainAborters.delete(prep.requestId)
      if (explainAborters.size === 0) announceActivityIdle()
    }
  })

  // /compact 手动压缩:把目前为止的对话提炼成一份要点摘要,
  // 渲染进程拦下 /compact 后走这条专属通道。流式增量照走 atlas:ai-delta 按 requestId 对号,
  // 「停一停」也照常能掐(登记进 explainAborters);压缩是程序差事,不接思考开关。
  ipcMain.handle(CH.aiCompact, async (event, req: unknown): Promise<AiExplainResult> => {
    const startedAt = Date.now()
    const body = (typeof req === 'object' && req !== null ? req : {}) as Record<string, unknown>
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    const history = sanitizeCompactHistory(body.history)
    if (history.length === 0) {
      return {
        status: 'error',
        text: '没有可压缩的对话:先聊几句再来',
        model: '',
        durationMs: Date.now() - startedAt
      }
    }
    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      return {
        status: 'error',
        text: resolved.error,
        model: '',
        durationMs: Date.now() - startedAt
      }
    }
    const aborter = new AbortController()
    if (requestId !== '') explainAborters.set(requestId, aborter)
    try {
      return await explainWithMessages(
        resolved.target,
        buildCompactMessages(history),
        makeDeltaSender(event, requestId),
        aborter.signal,
        resolved.budgets.replyTokens,
        {
          allowThinking: false,
          onRestart: () => sendResetDelta(event, requestId)
        }
      )
    } finally {
      if (requestId !== '') explainAborters.delete(requestId)
      if (explainAborters.size === 0) announceActivityIdle()
    }
  })

  // 试一句:设置页改完说话方式,拿草稿当场念一段听效果。
  // 关键在「草稿」二字 —— 走的是传进来的那份个性化,不是存档里的那份,
  // 所以还没点「应用更改」也能试,试完不满意直接退回,不用先存再改。
  ipcMain.handle(
    CH.aiStyleSample,
    async (event, personalization: unknown, requestId?: unknown): Promise<AiExplainResult> => {
      const resolved = await resolveChatTargetOrError()
      if ('error' in resolved) {
        return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
      }
      const style = buildPersonalizationPrompt(sanitizePersonalization(personalization))
      const system = withPersonalization(STYLE_SAMPLE_SYSTEM, style)
      return explainWithCancel(requestId, (signal) =>
        explainWithModel(
          resolved.target,
          STYLE_SAMPLE_QUESTION,
          system,
          makeDeltaSender(event, requestId),
          signal,
          resolved.budgets.replyTokens
        )
      )
    }
  )

  // 掐掉还在生成的讲解:渲染进程换了讲解目标/关掉卡片时喊一声,模型立刻空出来讲下一个
  ipcMain.handle(CH.aiCancel, (_event, requestId: unknown) => {
    if (typeof requestId !== 'string' || requestId === '') return
    explainAborters.get(requestId)?.abort()
    explainAborters.delete(requestId)
  })

  // 联网查证(可选举手):讲解认不出软件/品牌时,拿「名字」去公开源查免费资料。
  // 只许传名字,不许传本地路径 —— 隐私边界写在调用方;5 秒超时,查不到返回空串,上层自己回退。
  // Key 跟着配置走:用户填了 Tavily,这条通道也吃同一把 Key(Tavily → DDG → 维基)
  ipcMain.handle(CH.webLookup, async (_event, query: unknown) => {
    if (typeof query !== 'string' || query.trim() === '') return ''
    const { tavilyKey } = await loadAiConfig(userDataDir())
    return webLookup(query, { fetchText: electronFetchText, postJson: electronPostJson, tavilyKey })
  })

  // 右键文件链接复制完整路径:只往剪贴板写一个字符串,不开文件不执行任何东西 ——
  // 找到真文件后「开不开、怎么开」完全留给用户自己决定。路径照契约走 joinRoot 解析
  ipcMain.handle(CH.copyFilePath, (_event, rootPath: unknown, relPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath === '' || typeof relPath !== 'string') {
      return { ok: false as const, message: '路径信息不完整,复制不了' }
    }
    try {
      const abs = joinRoot(rootPath, relPath)
      clipboard.writeText(abs)
      return { ok: true as const, path: abs }
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : '复制失败' }
    }
  })

  // 右键文件链接「打开所在位置」:把资源管理器拉到文件面前、选中高亮,
  // 照样不开文件不执行任何东西 —— 到家门口为止,开不开门用户自己定
  ipcMain.handle(CH.revealFilePath, (_event, rootPath: unknown, relPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath === '' || typeof relPath !== 'string') {
      return { ok: false as const, message: '路径信息不完整,打不开' }
    }
    try {
      const abs = joinRoot(rootPath, relPath)
      if (!existsSync(abs))
        return { ok: false as const, message: '这个文件好像已经不在了,可能被移动或删除过' }
      shell.showItemInFolder(abs)
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : '打不开文件夹' }
    }
  })

  // 树文件夹右键「打开为工作区」:只负责 joinRoot + 确认是目录,不扫不换根。
  // 解析失败留在当前工作区(菜单上说人话);成功才把绝对路径交给地址栏那条扫描路。
  ipcMain.handle(CH.resolveFilePath, (_event, rootPath: unknown, relPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath === '' || typeof relPath !== 'string') {
      return { ok: false as const, message: '路径信息不完整,打不开' }
    }
    try {
      const abs = joinRoot(rootPath, relPath)
      if (!existsSync(abs))
        return { ok: false as const, message: '这个文件夹好像已经不在了,可能被移动或删除过' }
      if (!statSync(abs).isDirectory())
        return { ok: false as const, message: '这是一个文件,不是文件夹' }
      return { ok: true as const, path: abs }
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : '打不开' }
    }
  })
}
