// 文件翻译的活计:一次任务 = 按块顺序送模型,翻好一块推一块。
// 渲染层已经把原文读好了(走 read-preview),这里不碰文件系统。
import { ipcMain } from 'electron'
import { CH } from '../shared/ipcChannels.ts'
import { splitTranslateBlocks } from '../shared/translateBlocks.ts'
import { translateFamilyOf } from '../shared/translateGate.ts'
import { translateLang } from '../shared/translateLangs.ts'
import {
  titleLineOf,
  translateDocSystemPrompt,
  translateDocUserPrompt,
  translateSystemPrompt,
  translateTitleSystemPrompt,
  translateTitleUserPrompt,
  translateUserPrompt
} from '../shared/translatePrompt.ts'
import type { TranslateEvent, TranslateStartRequest } from '../shared/translateTypes.ts'
import type { AiExplainResult, ChatTarget } from '../shared/types.ts'
import { explainWithMessages } from '../ai/explain.ts'
import { resolveChatTargetOrError } from './aiEvidence.ts'

/** 标题就几个词,封顶免得模型借机写注释 */
const TITLE_REPLY_CAP = 80
/** 与 fileRename 基础名上限同档,IPC 边界再卡一次 */
const TITLE_MAX_CHARS = 120

/** 正在跑的任务:requestId → 掐断开关 */
const jobs = new Map<string, AbortController>()

/** 块越长,留给回话的 token 越多;封顶免得小模型把上下文吃光 */
function replyCapFor(text: string): number {
  return Math.min(4000, Math.max(800, Math.ceil(text.length * 0.9)))
}

/** 模型偶尔把整段包进代码围栏或 XML 外壳里:剥掉这层壳,内容不动 */
function cleanTranslated(raw: string): string {
  let text = raw.trim()
  for (let i = 0; i < 3; i++) {
    const before = text
    const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text)
    if (fenced) text = fenced[1].trim()
    const wrapped =
      /^<(source_markdown|source_plaintext|source_title|translation|output|result)[^>]*>\n?([\s\S]*?)\n?<\/\1>$/i.exec(
        text
      )
    if (wrapped) text = wrapped[2].trim()
    if (text === before) break
  }
  return text
}

function sanitize(raw: unknown): TranslateStartRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.requestId !== 'string' || r.requestId === '') return null
  if (typeof r.text !== 'string' || r.text.trim() === '') return null
  if (typeof r.lang !== 'string' || r.lang === '') return null
  if (typeof r.relPath !== 'string' || r.relPath === '') return null
  let title: string | undefined
  if (typeof r.title === 'string') {
    const t = r.title.trim()
    if (t !== '') title = t.slice(0, TITLE_MAX_CHARS)
  }
  return { requestId: r.requestId, text: r.text, lang: r.lang, relPath: r.relPath, title }
}

async function translateOnce(
  target: ChatTarget,
  system: string,
  user: string,
  signal: AbortSignal,
  cap: number
): Promise<AiExplainResult> {
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user }
  ]
  let res = await explainWithMessages(target, messages, undefined, signal, cap)
  // 小模型偶尔空回/抽风:同一段再试一次
  if (res.status === 'error' && !signal.aborted) {
    res = await explainWithMessages(target, messages, undefined, signal, cap)
  }
  return res
}

export function registerTranslateIpc(): void {
  ipcMain.handle(CH.translateStart, async (event, raw: unknown) => {
    const req = sanitize(raw)
    if (!req) return { ok: false, error: '翻译请求不完整' }
    const lang = translateLang(req.lang)
    if (!lang) return { ok: false, error: '这个目标语种还没登记' }
    const family = translateFamilyOf(req.relPath)
    if (family === null) return { ok: false, error: '这份文件不能翻译' }

    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) return { ok: false, error: resolved.error }

    const blocks = splitTranslateBlocks(req.text, req.relPath)
    if (blocks.length === 0) return { ok: false, error: '这份文件没有可翻译的内容' }

    const controller = new AbortController()
    jobs.set(req.requestId, controller)
    event.sender.once('destroyed', () => controller.abort())

    const send = (payload: TranslateEvent): void => {
      if (!event.sender.isDestroyed()) event.sender.send(CH.translateEvent, payload)
    }
    send({
      requestId: req.requestId,
      type: 'plan',
      total: blocks.length,
      kinds: blocks.map((b) => b.kind)
    })

    void (async () => {
      try {
        const system =
          family === 'plaintext' || family === 'markup'
            ? translateDocSystemPrompt(lang, family)
            : translateSystemPrompt(lang)
        const userOf =
          family === 'plaintext' || family === 'markup'
            ? translateDocUserPrompt
            : translateUserPrompt
        // 内联标题单独翻、不占块号;翻砸了不拖死正文(渲染层已用原文主名占着)
        if (req.title) {
          const titleRes = await translateOnce(
            resolved.target,
            translateTitleSystemPrompt(lang),
            translateTitleUserPrompt(req.title),
            controller.signal,
            TITLE_REPLY_CAP
          )
          if (controller.signal.aborted) return
          if (titleRes.status !== 'error' && titleRes.status !== 'cancelled') {
            const line = titleLineOf(cleanTranslated(titleRes.text))
            if (line !== '') {
              send({ requestId: req.requestId, type: 'title', text: line })
            }
          }
        }
        for (const block of blocks) {
          if (controller.signal.aborted) return
          // 代码块与 HTML 块不送模型;frontmatter 要翻(只翻值,提示词里交代)
          if (block.kind === 'code' || block.kind === 'meta') {
            send({
              requestId: req.requestId,
              type: 'block',
              index: block.index,
              text: block.text,
              kept: true
            })
            continue
          }
          const res = await translateOnce(
            resolved.target,
            system,
            userOf(block.text),
            controller.signal,
            replyCapFor(block.text)
          )
          if (controller.signal.aborted) return
          if (res.status === 'error' || res.status === 'cancelled') {
            send({
              requestId: req.requestId,
              type: 'error',
              index: block.index,
              message: res.text || '模型没翻出来'
            })
            return
          }
          send({
            requestId: req.requestId,
            type: 'block',
            index: block.index,
            text: cleanTranslated(res.text),
            kept: false
          })
        }
        send({ requestId: req.requestId, type: 'done' })
      } catch (err) {
        send({
          requestId: req.requestId,
          type: 'error',
          index: null,
          message: err instanceof Error ? err.message : String(err)
        })
      } finally {
        jobs.delete(req.requestId)
      }
    })()

    return { ok: true, total: blocks.length }
  })

  ipcMain.handle(CH.translateCancel, (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') return { ok: false }
    jobs.get(requestId)?.abort()
    jobs.delete(requestId)
    return { ok: true }
  })
}
