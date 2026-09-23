import { extOf } from './paths.ts'
import {
  accessDeniedMessage,
  effectiveTeaching,
  explainWithCancel,
  formatSize,
  makeDeltaSender,
  readHeader,
  readTextPreview,
  reportCache,
  resolveChatTargetOrError,
  respondWithEvidence,
  sendResetDelta
} from './aiEvidence.ts'
import { ipcMain } from 'electron'
import { basename } from 'node:path'
import { promises as fs } from 'node:fs'
import { analyzeSource, isAnalysisSupported } from '../analyzer/index.ts'
import {
  collectGitChanges,
  collectRecentSubjects,
  getChangeDiff,
  gitChangesSignature
} from '../git/index.ts'
import {
  explainWithModel,
  explainWithMessages,
  buildExplainPrompt,
  extractHeaderComment,
  buildDiffPrompt,
  buildFolderPrompt,
  buildGuessPrompt,
  buildBinaryPrompt,
  buildReportPrompt,
  buildLocatePrompt,
  buildTreeDigest,
  parseLocateReply,
  filterLocateHits,
  isContextOverflow,
  REPORT_ROW_LIMIT,
  sniffBinaryKind,
  DIFF_SYSTEM_PROMPT,
  REPORT_SYSTEM_PROMPT,
  LOCATE_SYSTEM_PROMPT,
  LOCATE_NODE_BUDGET
} from '../ai/index.ts'
import { BY_EXT } from '../shared/languages.ts'
import { joinRoot } from '../shared/paths.ts'
import { withPersonalization } from '../shared/personalization.ts'
import { buildExplainSystem, deepSourceChars, TEACHING_DEEP_MIN_CTX } from '../ai/prompts.ts'
import { SOURCE_PARSE_MAX_BYTES } from '../shared/analysisLimits.ts'
import { CH } from '../shared/ipcChannels.ts'
import type { AiExplainResult, FeatureLocateResult, ScanDirNode } from '../shared/types.ts'

export function registerGitIpc(): void {
  // git 改动总览:谁动了、动了多少行。不是 git 仓库时返回 isGitRepo=false,不炸
  ipcMain.handle(CH.gitChanges, (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    return collectGitChanges(rootPath)
  })

  // 人话讲解一个改动:diff 由主进程现场重取(不信任渲染进程传内容),再喂本地模型
  // 路径契约同 analyze-file:收 (rootPath, relPath),绝对路径只经 joinRoot 解析
  ipcMain.handle(
    CH.gitExplainChange,
    async (event, rootPath: unknown, relPath: unknown, requestId?: unknown) => {
      if (typeof rootPath !== 'string' || typeof relPath !== 'string') {
        throw new Error('参数不合法')
      }
      const changes = await collectGitChanges(rootPath)
      if (!changes.isGitRepo) {
        return {
          status: 'error',
          text: '这个文件夹不在 git 仓库里,没有改动可讲',
          model: '',
          durationMs: 0
        }
      }
      const change = changes.changes.find((c) => c.relPath === relPath)
      if (!change) {
        return { status: 'error', text: '这个文件当前没有改动', model: '', durationMs: 0 }
      }
      const changeDiff = await getChangeDiff(rootPath, change)
      if (!changeDiff) {
        return {
          status: 'error',
          text: change.binary ? '二进制文件没法逐行对比,讲不了' : '这个文件太大,讲不了(先拆小再试)',
          model: '',
          durationMs: 0
        }
      }
      if (!changeDiff.diff.trim()) {
        return {
          status: 'error',
          text: '这个文件没有可逐行对比的内容(可能只改了权限/编码)',
          model: '',
          durationMs: 0
        }
      }
      const resolved = await resolveChatTargetOrError()
      if ('error' in resolved) {
        return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
      }
      const prompt = buildDiffPrompt({
        relPath: change.relPath,
        kind: change.kind,
        diff: changeDiff.diff
      })
      return explainWithCancel(requestId, (signal) =>
        explainWithModel(
          resolved.target,
          prompt,
          withPersonalization(DIFF_SYSTEM_PROMPT, resolved.style),
          makeDeltaSender(event, requestId),
          signal,
          resolved.budgets.replyTokens
        )
      )
    }
  )

  // AI 干活报告(第六十三锤):整轮改动翻成大白话审计 —— 干了什么/账对不对/要不要细看。
  // 账本由主进程现场重取(渲染进程递不进假货);改动集没变就走签名缓存,不重复烧模型。
  // 报告比单句讲解长(三段式),生成上限放宽到 900 tokens。
  ipcMain.handle(CH.gitReport, async (event, rootPath: unknown, requestId?: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    const changes = await collectGitChanges(rootPath)
    if (!changes.isGitRepo) {
      return {
        status: 'error',
        text: '这个文件夹不在 git 仓库里,没有账本可审',
        model: '',
        durationMs: 0
      }
    }
    if (changes.changes.length === 0) {
      return {
        status: 'error',
        text: '当前没有任何改动 —— 账本干干净净,不用审。',
        model: '',
        durationMs: 0
      }
    }
    const subjects = await collectRecentSubjects(rootPath)
    const signature = gitChangesSignature(changes, subjects)
    const cached = reportCache.get(signature)
    if (cached) return cached
    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) {
      return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
    }
    const makeReport = (rowLimit: number): Promise<AiExplainResult> =>
      explainWithCancel(requestId, (signal) =>
        explainWithMessages(
          resolved.target,
          [
            { role: 'system', content: withPersonalization(REPORT_SYSTEM_PROMPT, resolved.style) },
            {
              role: 'user',
              content: buildReportPrompt(
                {
                  branch: changes.branch,
                  changes: changes.changes,
                  stats: { additions: changes.stats.additions, deletions: changes.stats.deletions },
                  recentSubjects: subjects
                },
                rowLimit
              )
            }
          ],
          makeDeltaSender(event, requestId),
          signal,
          resolved.budgets.replyTokens,
          { onRestart: () => sendResetDelta(event, requestId) }
        )
      )
    // 先按标准清单问;小上下文装不下就把账本砍到 30 行再试最后一次(400 时模型一个字都没吐,流式不会重影)
    let result = await makeReport(REPORT_ROW_LIMIT)
    if (result.status === 'error' && isContextOverflow(result.text)) {
      result = await makeReport(30)
    }
    if (result.status === 'supported') {
      reportCache.set(signature, result)
      // 缓存封顶:只留最近 20 份,最旧的先出,别让 Map 悄悄长胖
      if (reportCache.size > 20) {
        const oldest = reportCache.keys().next().value
        if (oldest !== undefined) reportCache.delete(oldest)
      }
    }
    return result
  })

  // 功能定位(第六十七锤):「这个功能在哪」—— 渲染进程把扫描树递过来(不重扫不读文件),
  // 带路人照着地图指路;指回来的每个地址都对照真树点名,编造的一律拦下,全被拦就老实说指不了。
  ipcMain.handle(
    CH.locateFeature,
    async (_event, tree: unknown, question: unknown, requestId?: unknown) => {
      if (
        !tree ||
        typeof tree !== 'object' ||
        (tree as ScanDirNode).type !== 'directory' ||
        !Array.isArray((tree as ScanDirNode).children) ||
        typeof question !== 'string' ||
        question.trim() === ''
      ) {
        throw new Error('参数不合法')
      }
      const root = tree as ScanDirNode
      // 这一路故意不吃个性化(第一百一十三锤):带路人要吐严格 JSON,
      // 掺进语气/格式要求有把格式带歪的风险,而它本来也不该有「文风」
      const resolved = await resolveChatTargetOrError()
      if ('error' in resolved) {
        return {
          status: 'error',
          hits: [],
          text: resolved.error,
          model: '',
          durationMs: 0
        } satisfies FeatureLocateResult
      }
      const askTheGuide = (tokenBudget: number): Promise<AiExplainResult> =>
        explainWithCancel(requestId, (signal) =>
          explainWithMessages(
            resolved.target,
            [
              { role: 'system', content: LOCATE_SYSTEM_PROMPT },
              {
                role: 'user',
                content: buildLocatePrompt({
                  digest: buildTreeDigest(root, LOCATE_NODE_BUDGET, tokenBudget),
                  question: question.trim()
                })
              }
            ],
            undefined,
            signal,
            resolved.budgets.replyTokens
          )
        )
      // 先按标准预算问;碰到小上下文装不下,把地图砍到三分之一再试最后一次
      let reply = await askTheGuide(resolved.budgets.mapTokens)
      if (reply.status === 'error' && isContextOverflow(reply.text)) {
        reply = await askTheGuide(Math.floor(resolved.budgets.mapTokens / 3))
      }
      if (reply.status !== 'supported') {
        const contextBlown = isContextOverflow(reply.text)
        return {
          status: 'error',
          hits: [],
          text: contextBlown
            ? '模型的上下文装不下这张地图(已经自动精简重试过还是不行)—— 把模型服务的上下文调大些,再回来问一次。'
            : reply.text,
          model: reply.model,
          durationMs: reply.durationMs
        } satisfies FeatureLocateResult
      }
      const hits = filterLocateHits(root, parseLocateReply(reply.text))
      if (hits.length === 0) {
        return {
          status: 'unsupported',
          hits: [],
          text: '带路人盯着地图,实在认不出这个功能住哪儿 —— 换个问法试试,或者先确认它真的在这个项目里。',
          model: reply.model,
          durationMs: reply.durationMs
        } satisfies FeatureLocateResult
      }
      return {
        status: 'supported',
        hits,
        text: '',
        model: reply.model,
        durationMs: reply.durationMs
      } satisfies FeatureLocateResult
    }
  )

  // 人话解释一个文件:自动分流 —— AST 认识的语言摆结构(证据最硬);
  // 不认识的用名字 + 内容片段让模型猜(声明不确定);二进制直接本地人话,不劳烦模型
  // 路径契约同 analyze-file:收 (rootPath, relPath),绝对路径只经 joinRoot 解析
  ipcMain.handle(
    CH.aiExplainFile,
    async (
      event,
      rootPath: unknown,
      relPath: unknown,
      languageId: unknown,
      requestId?: unknown,
      question?: unknown,
      note?: unknown
    ) => {
      if (
        typeof rootPath !== 'string' ||
        typeof relPath !== 'string' ||
        typeof languageId !== 'string'
      ) {
        throw new Error('参数不合法')
      }
      const ownerNote =
        typeof note === 'string' && note.trim() !== '' ? note.trim().slice(0, 100) : undefined
      const resolved = await resolveChatTargetOrError()
      if ('error' in resolved) {
        return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
      }
      const absPath = joinRoot(rootPath, relPath) // relPath 想越界会在这里被拦
      // stat 失败别吞成"不存在":系统核心文件(swapfile.sys 等)会给 EINVAL/EBUSY,得说真话
      const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
      if (stat instanceof Error) {
        throw new Error(accessDeniedMessage(stat, '文件', relPath), { cause: stat })
      }
      if (!stat.isFile()) {
        throw new Error(`这个路径不是一个文件:${relPath}`)
      }
      const name = relPath.split('/').pop() ?? relPath

      // 结构流:证据最硬 —— 函数/类/导入导出都摆给模型
      if (isAnalysisSupported(languageId) && stat.size <= SOURCE_PARSE_MAX_BYTES) {
        // 读内容也可能撞上独占/上锁(EBUSY/EPERM),同样走人话口径,不吐生面孔
        const code = await fs.readFile(absPath, 'utf8').catch((err: NodeJS.ErrnoException) => {
          throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
        })
        const structure = await analyzeSource(code, languageId)
        if (structure) {
          // 「详细」档喂源码(提示词体系重写第二批):锅够大才喂 —— 锅小 deep 已被降成 brief,
          // 那时节选照老规矩不垫;源码刚读过就在手边,截到 deepSourceChars(ctx) 字,读不到就静默不给
          const sourceExcerpt =
            resolved.teaching === 'deep' && resolved.ctx >= TEACHING_DEEP_MIN_CTX
              ? code.slice(0, deepSourceChars(resolved.ctx))
              : null
          return respondWithEvidence(
            event,
            requestId,
            question,
            buildExplainPrompt({
              relPath,
              name,
              languageName: structure.languageId,
              structure,
              graph: null,
              note: ownerNote,
              headerComment: extractHeaderComment(code),
              sourceExcerpt
            }),
            undefined,
            resolved
            // 结构流证据够硬(真代码结构),不掺联网查证
          )
        }
      }

      // 兜底流:猜猜官 —— 名字 + 内容片段,推测并声明不确定
      const preview =
        stat.size === 0
          ? ''
          : await readTextPreview(absPath).catch((err: NodeJS.ErrnoException) => {
              throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
            })
      if (preview === null) {
        // 二进制读不出文字:读文件头认类型当真证据,照样让模型讲,只是明说"按类型推测"
        const header = stat.size === 0 ? Buffer.alloc(0) : await readHeader(absPath)
        const kind = sniffBinaryKind(header, name)
        const typeInfo = kind
          ? kind.dims
            ? `${kind.type},尺寸 ${kind.dims}`
            : kind.type
          : '认不出具体格式(文件头不像任何已知类型)'
        return respondWithEvidence(
          event,
          requestId,
          question,
          buildBinaryPrompt({ relPath, name, typeInfo, sizeText: formatSize(stat.size) }),
          buildExplainSystem(effectiveTeaching(resolved).teaching, 'guess'),
          resolved,
          name
        )
      }
      const languageName = BY_EXT.get(extOf(name))?.name ?? ''
      return respondWithEvidence(
        event,
        requestId,
        question,
        buildGuessPrompt({ relPath, name, absPath, languageName, preview, note: ownerNote }),
        buildExplainSystem(effectiveTeaching(resolved).teaching, 'guess'),
        resolved,
        name
      )
    }
  )

  // 人话解释一个文件夹:目录清单就是证据;空文件夹直接本地人话,不劳烦模型
  // relPath 传 '' 表示解释项目根目录本身;自由聊天有专门的 atlas:ai-chat 通道
  ipcMain.handle(
    CH.aiExplainFolder,
    async (event, rootPath: unknown, relPath: unknown, requestId?: unknown, question?: unknown) => {
      if (typeof rootPath !== 'string' || typeof relPath !== 'string') {
        throw new Error('参数不合法')
      }
      const resolved = await resolveChatTargetOrError()
      if ('error' in resolved) {
        return { status: 'error', text: resolved.error, model: '', durationMs: 0 }
      }
      const absPath = joinRoot(rootPath, relPath)
      const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
      if (stat instanceof Error) {
        throw new Error(accessDeniedMessage(stat, '文件夹', relPath || '(根目录)'))
      }
      if (!stat.isDirectory()) {
        throw new Error(`这不是一个文件夹:${relPath || '(根目录)'}`)
      }
      let dirents
      try {
        dirents = await fs.readdir(absPath, { withFileTypes: true })
      } catch (err) {
        // stat 能过但 readdir 被拒:也是"锁着",不是空文件夹
        throw new Error(
          accessDeniedMessage(err as NodeJS.ErrnoException, '文件夹', relPath || '(根目录)'),
          { cause: err }
        )
      }
      if (dirents.length === 0) {
        return {
          status: 'unsupported',
          text: '这是个空文件夹,啥也没装,就不用劳烦模型了',
          model: '',
          durationMs: 0
        }
      }
      dirents.sort((a, b) => a.name.localeCompare(b.name))
      const subdirs: string[] = []
      const files: string[] = []
      const languages = new Map<string, number>()
      // 通用后缀分布:什么文件都数(.exe/.dll/.log 是认出系统文件夹的关键证据,编程语言认不出的也算)
      const extCounts = new Map<string, number>()
      for (const item of dirents) {
        if (item.isDirectory()) {
          subdirs.push(item.name)
          continue
        }
        if (!item.isFile()) continue // 符号链接等不靠谱的,跳过
        files.push(item.name)
        const langName = BY_EXT.get(extOf(item.name))?.name ?? '没认出的文件'
        languages.set(langName, (languages.get(langName) ?? 0) + 1)
        const dot = item.name.lastIndexOf('.')
        const ext = dot > 0 ? item.name.slice(dot).toLowerCase() : '(无后缀)'
        extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)
      }
      const folderName = basename(absPath) || basename(rootPath)
      return respondWithEvidence(
        event,
        requestId,
        question,
        buildFolderPrompt({
          relPath,
          name: folderName,
          absPath,
          subdirs,
          files,
          languages: Object.fromEntries(languages),
          extCounts: Object.fromEntries(extCounts)
        }),
        buildExplainSystem(effectiveTeaching(resolved).teaching, 'folder'),
        resolved,
        folderName
      )
    }
  )
}
