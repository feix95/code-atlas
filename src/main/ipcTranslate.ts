// 文件翻译的活计:一次任务 = 按块顺序送模型,翻好一块推一块。
// 渲染层已经把原文读好了(走 read-preview),这里不碰文件系统。
import { ipcMain } from 'electron'
import { CH } from '../shared/ipcChannels.ts'
import { splitMdBlocks } from '../shared/mdBlocks.ts'
import { translateLang } from '../shared/translateLangs.ts'
import { translateSystemPrompt, translateUserPrompt } from '../shared/translatePrompt.ts'
import type { TranslateEvent, TranslateStartRequest } from '../shared/translateTypes.ts'
import { explainWithMessages } from '../ai/explain.ts'
import { resolveChatTargetOrError } from './aiEvidence.ts'

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
      /^<(source_markdown|translation|output|result)[^>]*>\n?([\s\S]*?)\n?<\/\1>$/i.exec(text)
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
  return { requestId: r.requestId, text: r.text, lang: r.lang }
}

export function registerTranslateIpc(): void {
  ipcMain.handle(CH.translateStart, async (event, raw: unknown) => {
    const req = sanitize(raw)
    if (!req) return { ok: false, error: '翻译请求不完整' }
    const lang = translateLang(req.lang)
    if (!lang) return { ok: false, error: '这个目标语种还没登记' }

    const resolved = await resolveChatTargetOrError()
    if ('error' in resolved) return { ok: false, error: resolved.error }

    const blocks = splitMdBlocks(req.text)
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
        const system = translateSystemPrompt(lang)
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
          const messages = [
            { role: 'system' as const, content: system },
            { role: 'user' as const, content: translateUserPrompt(block.text) }
          ]
          let res = await explainWithMessages(
            resolved.target,
            messages,
            undefined,
            controller.signal,
            replyCapFor(block.text)
          )
          // 小模型偶尔空回/抽风:同一块再试一次,别为一次抖动丢掉前面几十块的成果
          if (res.status === 'error' && !controller.signal.aborted) {
            res = await explainWithMessages(
              resolved.target,
              messages,
              undefined,
              controller.signal,
              replyCapFor(block.text)
            )
          }
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
