// 自由对话的图片附件(第一百五十二批):类型、能力闸、token 估算、预算规划、收编洗白。
// 全是纯函数 —— 渲染层与主进程共用同一把尺子,自测一把全摁住。
import { sniffImage, type ImageMime } from './imageMeta.ts'
import { IMAGE_PREVIEW_MAX_BYTES } from './preview.ts'
import type { VisionSupport } from './types.ts'

/** 一轮最多带几张图(集中配置):小模型上下文有限,图一张顶几百上千 token */
export const CHAT_IMAGES_MAX = 3

/** 渲染层收图时的长边上限:超了先用画布压到这条线再发送 */
export const CHAT_IMAGE_LONG_EDGE = 1024

/** 主进程预算挤时仍给每张图保住的最小长边:再小就真看不清了,不如报错让人换图 */
export const CHAT_IMAGE_MIN_LONG_EDGE = 256

/** 一张已收编的图片:dataUrl 与字节魔数对过账,width/height 是真实像素尺寸 */
export interface ChatImage {
  id: string
  name: string
  mime: ImageMime
  /** 整张图的 data URL(data:image/(png|jpeg);base64,...),随请求发给模型 */
  dataUrl: string
  width: number
  height: number
}

/** OpenAI 多模态消息的一段:文字照旧,图片走 image_url(data URL) */
export type ChatContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

/** 一条消息的 content:纯文本是字符串,带图时是分段数组 */
export type ChatMessageContent = string | ChatContentPart[]

/**
 * 图片 token 的保守估算(纯函数,自测覆盖):模型无关的 Qwen-VL 式 28px 块口径 ——
 * 按 28 像素见方切块,一块记一个视觉 token,刻意宁高勿低(真实编码器常为 14px 块再压半,
 * 算下来比这个低);64 是下限,图再小也占读图开销。只用来掐预算,不是精确账。
 */
export function estimateImageTokens(width: number, height: number): number {
  const w = Math.max(1, Math.ceil(width))
  const h = Math.max(1, Math.ceil(height))
  return Math.max(64, Math.ceil(w / 28) * Math.ceil(h / 28))
}

/** 日志/账面里图片段的替身:dataUrl 不许进日志,一段图计几个占位字 */
export function contentTextLen(content: ChatMessageContent): number {
  if (typeof content === 'string') return content.length
  let len = 0
  for (const part of content) len += part.type === 'text' ? part.text.length : 4
  return len
}

/**
 * 图片入口的能力闸(纯函数,自测覆盖):渲染层(置灰/拒收)与主进程(拦截)同一把尺。
 * text-only → 拒收并说人话;vision → 放行;unknown → 放行但留一句不确定的提醒。
 */
export function imageGate(
  vision: VisionSupport | undefined,
  count: number
): { allow: boolean; reason?: string; hint?: string } {
  if (count <= 0) return { allow: true }
  if (vision === 'text-only') return { allow: false, reason: '当前模型是纯文本模型,看不了图片' }
  if (vision === 'vision') return { allow: true }
  return { allow: true, hint: '没法确认这个模型能不能看图' }
}

/** 预算规划给每张图定的配额:缩到的像素尺寸 + 估算 token 数 */
export interface ImageBudgetItem {
  width: number
  height: number
  tokens: number
}

export type ImageBudgetPlan = { ok: true; items: ImageBudgetItem[] } | { ok: false; reason: string }

/** 单张图按自己的份子钱缩尺寸:装得下就原样,装不下按面积比例缩(token 跟块数走 ≈ 跟面积走);
 *  28px 块取整会让估算略高于份子 —— 每轮把长边再砍一块(28px)直到纳入配额或达下限 256,
 *  到下限仍装不下就按 256 计入,交给总额检查判 ok:false,不许静默丢图 */
function fitImageToShare(width: number, height: number, shareTokens: number): ImageBudgetItem {
  const native = estimateImageTokens(width, height)
  if (native <= shareTokens) return { width, height, tokens: native }
  const longEdge = Math.max(width, height)
  // 首缩:面积比例一刀切到位,再逐步补刀
  const firstLong = Math.min(
    longEdge,
    Math.max(CHAT_IMAGE_MIN_LONG_EDGE, Math.floor(longEdge * Math.sqrt(shareTokens / native)))
  )
  const ratio = firstLong / longEdge
  let w = Math.max(1, Math.round(width * ratio))
  let h = Math.max(1, Math.round(height * ratio))
  let tokens = estimateImageTokens(w, h)
  while (tokens > shareTokens && Math.max(w, h) > CHAT_IMAGE_MIN_LONG_EDGE) {
    const nextLong = Math.max(CHAT_IMAGE_MIN_LONG_EDGE, Math.max(w, h) - 28)
    const r = nextLong / Math.max(w, h)
    w = Math.max(1, Math.round(w * r))
    h = Math.max(1, Math.round(h * r))
    tokens = estimateImageTokens(w, h)
  }
  return { width: w, height: h, tokens }
}

/**
 * 图片预算规划(纯函数,自测覆盖):图片总占用封顶 = 上下文的 50%,且不得挤到
 * 「人设+附件+问题+回答预留」没配额(otherTokens+replyTokens 先扣完再看剩多少)。
 * 每张图均分配额,放不下的按面积缩;缩到 256 长边还塞不进就 ok:false 给人话原因,
 * 让调用方报错 —— 不许静默丢图。
 */
export function planImageBudget(input: {
  ctxTokens: number
  replyTokens: number
  /** 已排定的固定开销(人设+附件+问题+联网资料),图片不许占用其配额 */
  otherTokens: number
  images: Array<{ width: number; height: number }>
}): ImageBudgetPlan {
  if (input.images.length === 0) return { ok: true, items: [] }
  const seatCap = Math.min(
    Math.floor(input.ctxTokens / 2),
    input.ctxTokens - input.otherTokens - input.replyTokens
  )
  if (seatCap <= 0) {
    return {
      ok: false,
      reason: '上下文连图片的配额都没有了(人设和材料已经占满):把模型上下文调大,或少带点材料再发'
    }
  }
  const share = Math.max(1, Math.floor(seatCap / input.images.length))
  const items = input.images.map((img) => fitImageToShare(img.width, img.height, share))
  const total = items.reduce((sum, it) => sum + it.tokens, 0)
  if (total > seatCap) {
    return {
      ok: false,
      reason: `这几张图缩到最小也要约 ${total} tokens,这轮上下文只剩约 ${seatCap}:把图片裁小点,或把模型上下文调大`
    }
  }
  return { ok: true, items }
}

// ── 主进程收编:渲染层递来的图片再过一遍筛,脏数据不许混进发给模型的消息 ──

export interface SanitizedChatImages {
  images: ChatImage[]
  /** 没收进来的图片各自的理由(给人看的,调用方用来报错/垫灰字) */
  rejected: string[]
}

const IMAGE_DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/

function decodeDataUrl(dataUrl: string): { mime: ImageMime; bytes: Uint8Array } | null {
  const match = IMAGE_DATA_URL.exec(dataUrl)
  if (!match) return null
  try {
    const bin = atob(match[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
    return { mime: match[1] === 'png' ? 'image/png' : 'image/jpeg', bytes }
  } catch {
    return null
  }
}

/**
 * 渲染层递来的图片列表洗成可发形状(纯函数,自测覆盖):
 * 数量封顶、mime 白名单、必须是 data:image/(png|jpeg);base64 的 data URL,
 * 解出的字节过 sniffImage 魔数校验、且声明的 mime 与魔数一致、单张不超大小上限。
 * 宽高以魔数里量出的真实尺寸为准(渲染层报的不全信);不合格的整张丢,理由留在 rejected 里。
 */
export function sanitizeChatImages(raw: unknown): SanitizedChatImages {
  const images: ChatImage[] = []
  const rejected: string[] = []
  if (!Array.isArray(raw)) return { images, rejected }
  for (const item of raw) {
    if (images.length >= CHAT_IMAGES_MAX) {
      rejected.push(`一次最多带 ${CHAT_IMAGES_MAX} 张图片,超出的没带进来`)
      break
    }
    if (typeof item !== 'object' || item === null) {
      rejected.push('有条图片数据是坏的,没带进来')
      continue
    }
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' && o.name.trim() !== '' ? o.name.trim() : '图片'
    const fail = (why: string): void => {
      rejected.push(`「${name}」${why}`)
    }
    if (o.mime !== 'image/png' && o.mime !== 'image/jpeg') {
      fail('不是 JPG/PNG,只支持这两种图片')
      continue
    }
    const dataUrl = typeof o.dataUrl === 'string' ? o.dataUrl : ''
    const decoded = decodeDataUrl(dataUrl)
    if (!decoded) {
      fail('的图片数据不是有效的 data URL,没带进来')
      continue
    }
    if (decoded.mime !== o.mime) {
      fail('声明的格式和数据对不上,没带进来')
      continue
    }
    if (decoded.bytes.length > IMAGE_PREVIEW_MAX_BYTES) {
      fail(`太大(超过 ${Math.floor(IMAGE_PREVIEW_MAX_BYTES / 1024 / 1024)}MB),换张小点的`)
      continue
    }
    const sniff = sniffImage(decoded.bytes)
    if (!sniff) {
      fail('不是有效的 JPG/PNG 图片(内容与后缀不符),没带进来')
      continue
    }
    if (sniff.mime !== o.mime) {
      fail('图片内容和声明的格式不一致,没带进来')
      continue
    }
    if (sniff.width === null || sniff.height === null) {
      fail('读不出尺寸,没带进来')
      continue
    }
    images.push({
      id: typeof o.id === 'string' && o.id !== '' ? o.id : crypto.randomUUID(),
      name,
      mime: sniff.mime,
      dataUrl,
      width: sniff.width,
      height: sniff.height
    })
  }
  return { images, rejected }
}
