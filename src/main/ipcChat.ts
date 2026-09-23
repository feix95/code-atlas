import { userDataDir } from './paths.ts'
import { announceActivityIdle } from './modelStatus.ts'
import {
  electronFetchText,
  electronPostJson,
  explainAborters,
  explainWithCancel,
  makeDeltaSender,
  resolveChatTargetOrError,
  sendChatLookup,
  sendResetDelta
} from './aiEvidence.ts'
import { runAgentChat } from './agentChat.ts'
import { clipboard, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { THINKING_EXTRA_TOKENS } from '../shared/aiDefaults.ts'
import {
  buildCompactMessages,
  sanitizeCompactHistory,
  sanitizeCompactSummary
} from '../shared/compact.ts'
import {
  codeRefsBudget,
  estimateTokens,
  explainWithModel,
  explainWithMessages,
  isContextOverflow,
  sanitizeHistory,
  buildAttachmentText,
  sanitizeAttachment,
  sanitizeCodeRefs,
  buildFreeChatMessages,
  pickWebLookupQuery,
  resolveWebLookupMeta,
  hasSearchIntent,
  STYLE_SAMPLE_SYSTEM,
  STYLE_SAMPLE_QUESTION
} from '../ai/index.ts'
import { webLookupDetailed, webLookup } from '../ai/weblookup.ts'
import { loadAiConfig } from '../ai/config.ts'
import { joinRoot } from '../shared/paths.ts'
import {
  buildPersonalizationPrompt,
  sanitizePersonalization,
  withPersonalization
} from '../shared/personalization.ts'
import { buildChatSystem } from '../ai/prompts.ts'
import { CH } from '../shared/ipcChannels.ts'
import type { AiChatResult, AiExplainResult, WebLookupMeta } from '../shared/types.ts'

export function registerChatIpc(): void {
  // 自由对话:独立通道、独立人设(Atlas 小探针)。当前选中对象的资料以「附件」身份
  // 垫在最前面,仅供参考,不进历史 —— 换对象不带旧资料,旧对话也不污染新对象。
  // 用户点名要联网(联网/搜搜/查查…)且开关开着,程序先按名字真查一份资料再开答;
  // 查询的每一步状态(查着了/没查到/没开开关)都以程序账本为准回传,模型说了不算。
  ipcMain.handle(CH.aiChat, async (event, req: unknown): Promise<AiChatResult> => {
    const startedAt = Date.now()
    const notRequested: WebLookupMeta = {
      requested: false,
      enabled: false,
      attempted: false,
      state: 'not_requested',
      sources: []
    }
    const body = (typeof req === 'object' && req !== null ? req : {}) as Record<string, unknown>
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    // 带了引用就允许「只发代码不发问题」,这时给一句通用问法当题目 ——
    // 光甩几段代码过去,模型不知道该讲哪一面。先用保底账探一下有没有引用,
    // 真正按这轮的锅裁额度,要等模型服务和思考开关都落定之后(见下方 codeRefs)
    const hasRefs = sanitizeCodeRefs(body.codeRefs).length > 0
    if (!question && !hasRefs) {
      return {
        status: 'error',
        text: '先输入一句话再发送',
        model: '',
        durationMs: 0,
        webLookup: notRequested
      }
    }
    const questionText = question || '讲讲选中的这段代码'
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    const history = sanitizeHistory(body.history)
    const attachment = sanitizeAttachment(body.context)
    // 思考模式(第一百一十五锤):界面开关说了算;开着就允许模型先想一遍,思考过程展示给用户
    const thinking = body.thinking === true
    const requested = hasSearchIntent(questionText)

    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      // 模型服务都没通,查询自然也没发生:如实记成 failed,不让账本装无事发生
      const meta: WebLookupMeta = requested
        ? { requested: true, enabled: false, attempted: false, state: 'failed', sources: [] }
        : notRequested
      return {
        status: 'error',
        text: resolved.error,
        model: '',
        durationMs: Date.now() - startedAt,
        webLookup: meta
      }
    }

    // 联网查询先行:状态边查边播报(searching → completed/failed/empty),不等模型开金口
    const enabled = resolved.webLookup
    let outcome:
      | { kind: 'skipped' }
      | { kind: 'attempted'; material: string; sources: string[] }
      | { kind: 'error' } = { kind: 'skipped' }
    let webMaterial: { query: string; material: string } | null = null
    if (requested && enabled) {
      const query = pickWebLookupQuery(questionText, attachment)
      sendChatLookup(event, requestId, 'searching', [])
      try {
        // 源队列在纯函数层:Tavily 有 Key 打头,没 Key 走免费链(DDG → 维基)
        const found = await webLookupDetailed(query, {
          fetchText: electronFetchText,
          postJson: electronPostJson,
          tavilyKey: resolved.tavilyKey
        })
        outcome = { kind: 'attempted', material: found.material, sources: found.sources }
        if (found.material) webMaterial = { query, material: found.material }
      } catch {
        outcome = { kind: 'error' }
      }
      const finalState =
        outcome.kind === 'attempted' ? (outcome.material === '' ? 'empty' : 'completed') : 'failed'
      sendChatLookup(
        event,
        requestId,
        finalState,
        outcome.kind === 'attempted' ? outcome.sources : []
      )
    }

    const meta = resolveWebLookupMeta(requested, enabled, outcome)
    // 闲聊底座 = 内核 + 聊天切片;翻文件开着时无工具切片不挂(翻文件切片由 agent 路自己追加)
    const systemPrompt = withPersonalization(
      buildChatSystem({ agent: body.agent === true }),
      resolved.style
    )
    // 开思考就多给一笔推理额度:思考段也算在 max_tokens 里,不加额度思考就把答案吃光(第一百一十五锤)
    const cap = thinking
      ? resolved.budgets.replyTokens + THINKING_EXTRA_TOKENS
      : resolved.budgets.replyTokens
    // 引用的动态账(第一百二十六锤):锅里先给人设+附件+历史+问题留座,回答(含思考预留)也占座,
    // 剩下的折成字符才是引用能带的量;穷保底、富封顶,额度跟着用户设的上下文走
    const otherTokens =
      estimateTokens(systemPrompt) +
      estimateTokens(attachment ? buildAttachmentText(attachment) : '') +
      estimateTokens(history.map((h) => h.content).join('\n')) +
      estimateTokens(questionText) +
      estimateTokens(webMaterial ? webMaterial.material : '')
    const refsBudget = codeRefsBudget({
      contextTokens: resolved.ctx,
      otherTokens,
      replyTokens: cap
    })
    const codeRefs = sanitizeCodeRefs(body.codeRefs, refsBudget)
    const questionText2 = question || (codeRefs.length > 0 ? '讲讲选中的这段代码' : questionText)
    // 手动压缩的早前对话摘要(第一百四十二锤):/compact 之后每次请求都带,垫在历史前面当背景记忆
    const summary = sanitizeCompactSummary(body.summary)
    const messages = buildFreeChatMessages(
      systemPrompt,
      attachment,
      history,
      questionText2,
      webMaterial,
      codeRefs,
      resolved.teaching,
      summary
    )
    // 翻文件模式(agent,第一百二十八锤):开关开着就走工具循环 —— 模型自己喊看哪,
    // 主进程沙盒里翻给它看;rootPath 是沙盒的墙,没带或不对就老实说翻不了
    if (body.agent === true) {
      const agentRoot =
        typeof body.rootPath === 'string' && body.rootPath.trim() !== '' ? body.rootPath : ''
      if (agentRoot === '') {
        return {
          status: 'error',
          text: '翻文件模式得先打开一个项目才有得翻:关掉「翻文件」开关,或先在左边打开项目再问',
          model: '',
          durationMs: Date.now() - startedAt,
          webLookup: meta
        }
      }
      const aborter = new AbortController()
      if (requestId !== '') explainAborters.set(requestId, aborter)
      try {
        return await runAgentChat({
          event,
          requestId,
          target: resolved.target,
          systemPrompt,
          baseMessages: messages,
          rootPath: agentRoot,
          ctx: resolved.ctx,
          replyCap: cap,
          allowThinking: thinking,
          signal: aborter.signal,
          startedAt,
          webLookup: meta,
          webSearchEnabled: resolved.webLookup === true,
          tavilyKey: resolved.tavilyKey
        })
      } finally {
        if (requestId !== '') explainAborters.delete(requestId)
        if (explainAborters.size === 0) announceActivityIdle()
      }
    }
    const aborter = new AbortController()
    if (requestId !== '') explainAborters.set(requestId, aborter)
    try {
      const streamOpts = {
        allowThinking: thinking,
        onRestart: () => sendResetDelta(event, requestId)
      }
      let res = await explainWithMessages(
        resolved.target,
        messages,
        makeDeltaSender(event, requestId),
        aborter.signal,
        cap,
        streamOpts
      )
      // 上下文爆了的自动救援(自动压缩那案):服务拒收时模型一个字没吐,把旧聊天史砍到最近 2 条重试一轮;
      // 只兜一次,再爆就照实给指路话,不跟它无限耗
      if (res.status === 'error' && isContextOverflow(res.text)) {
        sendResetDelta(event, requestId)
        const slimMessages = buildFreeChatMessages(
          systemPrompt,
          attachment,
          history.slice(-2),
          questionText2,
          webMaterial,
          codeRefs,
          resolved.teaching,
          summary
        )
        res = await explainWithMessages(
          resolved.target,
          slimMessages,
          makeDeltaSender(event, requestId),
          aborter.signal,
          cap,
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
      return { ...res, status, webLookup: meta }
    } finally {
      if (requestId !== '') explainAborters.delete(requestId)
      if (explainAborters.size === 0) announceActivityIdle()
    }
  })

  // /compact 手动压缩(第一百四十二锤):把目前为止的对话提炼成一份要点摘要,
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

  // 试一句(第一百一十三锤):设置页改完说话方式,拿草稿当场念一段听效果。
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
    if (
      typeof rootPath !== 'string' ||
      rootPath === '' ||
      typeof relPath !== 'string' ||
      relPath === ''
    ) {
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

  // 右键文件链接「在文件资源管理器中显示」:把资源管理器拉到文件面前、选中高亮,
  // 照样不开文件不执行任何东西 —— 到家门口为止,开不开门用户自己定
  ipcMain.handle(CH.revealFilePath, (_event, rootPath: unknown, relPath: unknown) => {
    if (
      typeof rootPath !== 'string' ||
      rootPath === '' ||
      typeof relPath !== 'string' ||
      relPath === ''
    ) {
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
}
