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
import { agentDirectoryAccess, sendAgentStep } from './agentTools.ts'
import { droppedRoundsNotice, planChatMemory, rememberAgentTurn } from './chatMemory.ts'
import { estimateThreadTokens, toPlainHistory } from '../ai/chatThread.ts'
import { sanitizeConversationId } from '../ai/chatSessions.ts'
import { buildFileMemoNote, createChatFileMemoStore } from '../ai/chatFileMemo.ts'
import { imageGate, planImageBudget, sanitizeChatImages } from '../shared/chatImage.ts'
import { planFileAttachments, sanitizeChatFiles } from '../shared/chatFiles.ts'
import { shrinkChatImage } from './imageShrink.ts'
import { probeChatVision } from './modelStatus.ts'
import type { AgentChatMessage } from '../ai/agent.ts'
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
  buildAttachmentText,
  buildFileAttachmentsText,
  READ_HONESTY_NOTE,
  sanitizeAttachment,
  sanitizeCodeRefs,
  buildFreeChatMessages,
  pickWebLookupQuery,
  resolveWebLookupMeta,
  hasSearchIntent,
  STYLE_SAMPLE_SYSTEM,
  STYLE_SAMPLE_QUESTION,
  type PlannedChatFile
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
import type {
  AiChatResult,
  AiExplainResult,
  AiHistoryMessage,
  WebLookupMeta
} from '../shared/types.ts'

/** 附件登记表(附件追问本批):最近带过的文件附件记在内存里,下一轮垫成注记(详见 ai/chatFileMemo.ts) */
const chatFileMemo = createChatFileMemoStore()

export function registerChatIpc(): void {
  // 自由对话:独立通道、独立人设(Atlas 小探针)。当前选中对象的资料以「附件」身份
  // 垫在最前面,仅供参考,不进历史 —— 换对象不带旧资料,旧对话也不污染新对象。
  // 用户点名要联网(联网/搜搜/查查…)且开关开着,程序先按名字真查一份资料再开答;
  // 查询的每一步状态(查着了/没查到/没开开关)都以程序状态表为准回传,模型说了不算。
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
    // 图片附件(第一百五十二批):先洗白收编 —— 数量/格式/魔数/大小都验过。
    // 带了图却一张没进来的,直接说清为什么不放行,不静默丢图
    const imgSan = sanitizeChatImages(body.images)
    const images = imgSan.images
    if (Array.isArray(body.images) && body.images.length > 0 && images.length === 0) {
      return {
        status: 'error',
        text: `图片没能收进来:${imgSan.rejected.join(';') || '格式不支持'}`,
        model: '',
        durationMs: Date.now() - startedAt,
        webLookup: notRequested
      }
    }
    // 文件附件(对齐 Claude Code 的 @文件):同图片一个口径先洗白收编 ——
    // 数量/形状都验过;带了文件却一个都没进来的,直接说清为什么不放行,不静默丢文件
    const fileSan = sanitizeChatFiles(body.files)
    const files = fileSan.files
    if (Array.isArray(body.files) && body.files.length > 0 && files.length === 0) {
      return {
        status: 'error',
        text: `文件没能收进来:${fileSan.rejected.join(';') || '读不出内容'}`,
        model: '',
        durationMs: Date.now() - startedAt,
        webLookup: notRequested
      }
    }
    // 带引用/文件就允许「只发资料不发问题」,这时给一句通用问法当题目 ——
    // 光甩几段代码过去,模型不知道该讲哪一面。先用保底账探一下有没有引用,
    // 真正按本轮上下文窗口裁额度,要等模型服务和思考开关都落定之后(见下方 codeRefs);
    // 只发图、只发文件都不发字也行 —— 图和文件本身就是题目,给一句兜底问法
    const hasRefs = sanitizeCodeRefs(body.codeRefs).length > 0
    if (!question && !hasRefs && images.length === 0 && files.length === 0) {
      return {
        status: 'error',
        text: '先输入一句话再发送',
        model: '',
        durationMs: 0,
        webLookup: notRequested
      }
    }
    const questionText =
      question ||
      (files.length > 0
        ? images.length > 0
          ? '看看带进来的图片和文件,说说里面是什么'
          : '看看带进来的文件,说说里面是什么'
        : images.length > 0
          ? '看看这张图片,说说你看到了什么'
          : '讲讲选中的这段代码')
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    const attachment = sanitizeAttachment(body.context)
    // 思考模式(第一百一十五批):界面开关说了算;开着就允许模型先想一遍,思考过程展示给用户
    const thinking = body.thinking === true
    const requested = hasSearchIntent(questionText)
    // 图片入口的能力闸:带图先问模型认不认图 —— 渲染层置灰和这里拦截用同一把尺 imageGate;
    // 纯文本模型直接拦下说人话,绝不把图悄悄扔了当纯文字发
    if (images.length > 0) {
      const gate = imageGate(
        await probeChatVision(await loadAiConfig(userDataDir())),
        images.length
      )
      if (!gate.allow) {
        return {
          status: 'error',
          text: gate.reason ?? '当前模型看不了图片',
          model: '',
          durationMs: Date.now() - startedAt,
          webLookup: notRequested
        }
      }
      if (gate.hint) sendAgentStep(event, requestId, gate.hint)
      if (imgSan.rejected.length > 0)
        sendAgentStep(event, requestId, `有图片没带进来:${imgSan.rejected.join(';')}`)
    }
    // 翻文件模式跟图片不对付(第一百五十二批):带图这轮强制不翻,垫句灰字说清楚
    // (文件附件是纯文本,跟翻文件不冲突,两者可以一起用 —— 附件截断时探针还能顺着 offset 续读)
    const agentOn = body.agent === true && images.length === 0
    if (body.agent === true && !agentOn) sendAgentStep(event, requestId, '这一轮带图片,没有翻文件')
    // 有文件没带进来的(部分被拒):垫句灰字照实说,别装无事发生
    if (files.length > 0 && fileSan.rejected.length > 0)
      sendAgentStep(event, requestId, `有文件没带进来:${fileSan.rejected.join(';')}`)

    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      // 模型服务都没通,查询自然也没发生:如实记成 failed,不让状态表装无事发生
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
    const systemPrompt = withPersonalization(buildChatSystem({ agent: agentOn }), resolved.style)
    // 开思考就多给一笔推理额度:思考段也算在 max_tokens 里,不加额度思考就把答案吃光(第一百一十五批)
    const cap = thinking
      ? resolved.budgets.replyTokens + THINKING_EXTRA_TOKENS
      : resolved.budgets.replyTokens
    // 图片优先让路(第一百五十二批):预算规划给每张图定缩到的尺寸与估算 token,
    // 估算并进固定开销 —— 历史和代码引用自然从剩余配额里划,不另开同一数据源;
    // 装不下就报人话错误,绝不静默丢图
    let sendImages = images
    let imageTokens = 0
    const baseFixedTokens =
      estimateTokens(systemPrompt) +
      estimateTokens(attachment ? buildAttachmentText(attachment) : '') +
      estimateTokens(questionText) +
      estimateTokens(webMaterial ? webMaterial.material : '')
    if (images.length > 0) {
      const plan = planImageBudget({
        ctxTokens: resolved.ctx,
        replyTokens: cap,
        otherTokens: baseFixedTokens,
        images: images.map((img) => ({ width: img.width, height: img.height }))
      })
      if (!plan.ok) {
        return {
          status: 'error',
          text: plan.reason,
          model: '',
          durationMs: Date.now() - startedAt,
          webLookup: meta
        }
      }
      imageTokens = plan.items.reduce((sum, it) => sum + it.tokens, 0)
      sendImages = images.map((img, i) => {
        const seat = plan.items[i]
        return seat.width === img.width && seat.height === img.height
          ? img
          : shrinkChatImage(img, seat.width, seat.height)
      })
    }
    // 文件附件(对齐 Claude Code 的 @文件):整份装得下就整份带,装不下按行截断,
    // 行账明写给模型;额度跟着上下文走(穷保底、富封顶),和图片/引用同一个预算口径。
    // 附件登记表(附件追问本批):先取此前收过的文件注记垫在本轮资料前,再把这轮的附件记进账
    const memoConversationId = sanitizeConversationId(body.conversationId)
    const memoEntries = chatFileMemo
      .peek(memoConversationId)
      .filter((m) => !files.some((f) => f.name === m.name))
    const memoNote = buildFileMemoNote(memoEntries)
    let filesBlock: string | null = null
    if (files.length > 0) {
      const plan = planFileAttachments({
        ctxTokens: resolved.ctx,
        replyTokens: cap,
        otherTokens: baseFixedTokens + imageTokens,
        files: files.map((f) => ({ text: f.text, totalLines: f.totalLines }))
      })
      // 拖入即授权(第一百五十三批):系统拖/选进来的文件凭它的绝对路径换本次运行的
      // 只读授权令牌,截断的正文就有续读的钥匙;拿不到授权令牌(文件没了/不是文件)就照实说,
      // 绝不开空头支票
      const plannedFiles: PlannedChatFile[] = []
      for (const [i, f] of files.entries()) {
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
      filesBlock = buildFileAttachmentsText(plannedFiles, { agentOn })
    }
    const attachLayers = [memoNote, filesBlock].filter((x): x is string => x !== null)
    const attachBlock =
      attachLayers.length > 0 ? [...attachLayers, READ_HONESTY_NOTE].join('\n\n') : null
    const fileTokens = attachBlock ? estimateTokens(attachBlock) : 0
    // 对话记忆:按模型档位规划历史(小模型档按预算装会话线程,大模型档保持旧行为);
    // 固定开销 = 人设+附件+本轮问题+联网资料+图片+文件,历史预算从剩余配额里划
    const fixedTokens = baseFixedTokens + imageTokens + fileTokens
    const memory = planChatMemory({
      body,
      provider: resolved.provider,
      contextTokens: resolved.ctx,
      fixedTokens,
      replyTokens: cap
    })
    const plainHistory = toPlainHistory(memory.planned.messages)
    const droppedNotice = droppedRoundsNotice(memory.planned)
    if (droppedNotice) sendAgentStep(event, requestId, droppedNotice)
    // 引用的动态账(第一百二十六批):上下文窗口先给人设+附件+历史+问题留座,回答(含思考预留)也占座,
    // 剩下的折成字符才是引用能带的量;穷保底、富封顶,额度跟着用户设的上下文走
    const otherTokens =
      fixedTokens + estimateThreadTokens(agentOn ? memory.planned.messages : plainHistory)
    const refsBudget = codeRefsBudget({
      contextTokens: resolved.ctx,
      otherTokens,
      replyTokens: cap
    })
    const codeRefs = sanitizeCodeRefs(body.codeRefs, refsBudget)
    const questionText2 = question || (codeRefs.length > 0 ? '讲讲选中的这段代码' : questionText)
    // 手动压缩的早前对话摘要(第一百四十二批):/compact 之后每次请求都带,垫在历史前面当背景记忆
    const summary = sanitizeCompactSummary(body.summary)
    const assembleMessages = <H extends AgentChatMessage = AiHistoryMessage>(chatHistory: H[]) =>
      buildFreeChatMessages(
        systemPrompt,
        attachment,
        chatHistory,
        questionText2,
        webMaterial,
        codeRefs,
        resolved.teaching,
        summary,
        sendImages,
        attachBlock ?? undefined
      )
    // 翻文件模式(agent,第一百二十八批):开关开着就走工具循环 —— 模型自己喊看哪,
    // 主进程沙盒里翻给它看;rootPath 是沙盒的墙,没带或不对就老实说翻不了
    if (agentOn) {
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
          baseMessages: assembleMessages(memory.planned.messages),
          rootPath: agentRoot,
          ctx: resolved.ctx,
          replyCap: cap,
          allowThinking: thinking,
          signal: aborter.signal,
          startedAt,
          webLookup: meta,
          webSearchEnabled: resolved.webLookup === true,
          tavilyKey: resolved.tavilyKey,
          onTurnComplete: (trace, answer) => rememberAgentTurn(memory, question, trace, answer)
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
        assembleMessages(plainHistory),
        makeDeltaSender(event, requestId),
        aborter.signal,
        cap,
        streamOpts
      )
      // 上下文爆了的自动救援(自动压缩那案):服务拒收时模型一个字没吐,把旧聊天史砍到最近 2 条重试一轮;
      // 只兜一次,再爆就照实给指路话,不跟它无限耗
      if (res.status === 'error' && isContextOverflow(res.text)) {
        sendResetDelta(event, requestId)
        res = await explainWithMessages(
          resolved.target,
          assembleMessages(plainHistory.slice(-2)),
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

  // /compact 手动压缩(第一百四十二批):把目前为止的对话提炼成一份要点摘要,
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

  // 试一句(第一百一十三批):设置页改完说话方式,拿草稿当场念一段听效果。
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
