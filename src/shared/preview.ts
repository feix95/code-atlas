// ── 代码预览的取数规矩(纯函数,自测覆盖)──
// 全文预览(2026-09-13 小葵拍的板):整份文本拿在手里,画面上只画一屏(虚拟滚动)——
// 滚动条是全文的行程,元素永远只有可视区那一截。原来的行数/字数两道闸防的本来就是
// 「座位表排全文」,病根除了,闸一起退役;只剩一道谢客线挡几百 MB 的日志怪。
// 二进制 / 超大文件在 IPC 层就被挡住,走不到这儿。

import { CODE_REF_CHARS_MAX } from './aiDefaults.ts'

/** 超过这个体积的文本文件不预览:纯文本揣内存里不重,但几百 MB 的日志怪别请进门 */
export const PREVIEW_MAX_BYTES = 10 * 1024 * 1024

/** 预览正文 + 账目(全文预览后没有「截断」这回事,总行数永远是全文行数) */
export interface PreviewClip {
  /** 给界面看的正文(全文,只做过换行归一) */
  text: string
  /** 文件真实总行数 */
  totalLines: number
}

/**
 * 只做两件事:换行符归一(CRLF/裸 CR 都收成 LF,界面上不留半个回车)+ 数总行数;
 * 一个字都不裁。结尾的换行符造出来的空尾巴不算一行(不然「共 N 行」会多报一行)。
 */
export function clipPreview(raw: string): PreviewClip {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const totalLines =
    lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  return { text: normalized, totalLines }
}

/** 虚拟滚动的可视区:该画第几行到第几行(1 起,含两端) */
export interface VisibleRange {
  start: number
  end: number
}

/**
 * 可视行号账(纯函数,自测覆盖):滚到哪、视口多高,算出该画哪几行 ——
 * 上下各多带几行缓冲,快速滚动才不露白;滚出账面这种理论到不了的情况,老实看最后一屏。
 */
export function visibleLineRange(opts: {
  scrollTop: number
  viewportHeight: number
  lineHeight: number
  totalLines: number
  /** 视口外上下各多画几行(默认 20) */
  bufferLines?: number
}): VisibleRange {
  const lh = opts.lineHeight > 0 ? opts.lineHeight : 20
  const buffer = opts.bufferLines ?? 20
  if (opts.totalLines <= 0) return { start: 1, end: 0 }
  const first = Math.floor(Math.max(0, opts.scrollTop) / lh) + 1
  const visible = Math.ceil(Math.max(0, opts.viewportHeight) / lh)
  if (first > opts.totalLines) {
    // 防御:滚动位置冲出账面(到不了,但别让界面上画出空白行号)
    const start = Math.max(1, opts.totalLines - (visible + 2 * buffer - 1))
    return { start, end: opts.totalLines }
  }
  const start = Math.max(1, first - buffer)
  const end = Math.min(opts.totalLines, first + visible + buffer)
  return { start, end: Math.max(start, end) }
}

/** 开头这段字节像不像二进制:有 NUL 字节就是(文本文件(UTF-8/GBK/ASCII)都不含 NUL) */
export function looksBinary(head: Uint8Array): boolean {
  for (const byte of head) {
    if (byte === 0) return true
  }
  return false
}

/** 整份代码挂去对话的那笔账 + 钮上怎么说(第一百一十四锤补2) */
export interface WholeFileRefPlan {
  /** 额度没满,点得动 */
  canAdd: boolean
  /** 真正挂到输入框上的正文 */
  code: string
  startLine: number
  endLine: number
  /** 钮上写什么 */
  label: string
  /** 悬停说明:老实交代带什么、不带什么 */
  title: string
}

/**
 * 把「眼前这份代码」算成一条引用(纯函数,自测覆盖)。
 * 一轮的引用额度是三边共读的同一个数(单段 2000 字),整份超了只带开头 ——
 * 裁法跟主进程 sanitizeCodeRefs 一致(截断后留省略号),所以送出去的和界面上说的是同一件事。
 * 行号报的是「真正带上了第 1-N 行」,不是文件的最后一行 —— 引用卡上的行号不许撒谎。
 * 全文预览后文件本身总是齐的,带不完整份只剩「额度不够」这一个来由。
 */
export function planWholeFileRef(input: {
  text: string
  refLimit: number
  canAddRef: boolean
  charCap?: number
}): WholeFileRefPlan {
  const cap = input.charCap ?? CODE_REF_CHARS_MAX
  const byCap = input.text.length > cap
  const kept = byCap ? input.text.slice(0, cap) : input.text
  // 恰好切在换行符上时,别把没带上的下一行也算进来
  const tail = kept.endsWith('\n') ? kept.slice(0, -1) : kept
  return {
    canAdd: input.canAddRef,
    code: byCap ? `${kept}……` : kept,
    startLine: 1,
    endLine: tail.split('\n').length,
    label: !input.canAddRef ? '引用已满' : byCap ? '引用开头一段' : '引用全文',
    title: !input.canAddRef
      ? `一轮最多引用 ${input.refLimit} 段,想换新的先删掉一段`
      : byCap
        ? `这份代码比一轮的引用额度大,只带开头 ${cap} 字`
        : '把这份代码整个引用到右栏对话框,接着就能问小探针'
  }
}
