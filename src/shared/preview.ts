// ── 代码预览的取数规矩(纯函数,自测覆盖)──
// 预览只给「够看懂」的一段:行数和字数双封顶,超了如实标截断 —— 绝不静默腰斩,
// 也不把整个大文件一口气摆到屏幕上。二进制 / 超大文件在 IPC 层就被挡住,走不到这儿。

import { CODE_REF_CHARS_MAX } from './aiDefaults.ts'

/** 预览最多给多少行:再多屏幕上也读不完,只会拖慢渲染 */
export const PREVIEW_MAX_LINES = 2000

/** 预览最多给多少字:行数没超但单行超长(压缩过的 js/一行几千字的 md)时的第二道闸 */
export const PREVIEW_MAX_CHARS = 120_000

/** 超过这个体积的文本文件不预览:读进来就是白占内存(小葵的规矩:不产生无谓垃圾) */
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024

/** 裁好的预览正文 + 对账用的账目 */
export interface PreviewClip {
  /** 给界面看的正文(已裁到上限内) */
  text: string
  /** 文件真实总行数(裁没裁都是它,拿它对账「只载入了前 N 行」) */
  totalLines: number
  /** 正文被裁过 */
  truncated: boolean
}

/**
 * 把整份文本裁成能预览的一段:先统一换行(CRLF/CR 都归一成 LF,免得界面上残留
 * 半个回车),再按行数、字数两道闸依次裁;任何一道动了手都如实标 truncated。
 */
export function clipPreview(raw: string, maxLines = PREVIEW_MAX_LINES, maxChars = PREVIEW_MAX_CHARS): PreviewClip {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  // 末尾空行是文件结尾的换行符造出来的,不是真的一行,账目上不算
  const totalLines = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  const byLines = lines.slice(0, maxLines)
  let text = byLines.join('\n')
  let truncated = lines.length > maxLines
  if (text.length > maxChars) {
    text = text.slice(0, maxChars)
    truncated = true
  }
  return { text, totalLines, truncated }
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
 * 把「眼前这一整份代码」算成一条引用(纯函数,自测覆盖)。
 * 一轮的引用额度是三边共读的同一个数(单段 2000 字),整份超了只带开头 ——
 * 裁法跟主进程 sanitizeCodeRefs 一致(截断后留省略号),所以送出去的和界面上说的是同一件事。
 * 行号报的是「真正带上了第 1-N 行」,不是文件的最后一行 —— 引用卡上的行号不许撒谎。
 * 带不完整份有两个来由(额度不够、或文件太长压根没载全),钮上一律只说「开头一段」,
 * 具体是哪个来由写在悬停说明里:说清就行,不必让钮长出三头六臂。
 */
export function planWholeFileRef(input: {
  text: string
  refLimit: number
  canAddRef: boolean
  /** 正文只载入了开头一段(文件太长),没载进来的那部分也带不上 */
  previewTruncated?: boolean
  charCap?: number
}): WholeFileRefPlan {
  const cap = input.charCap ?? CODE_REF_CHARS_MAX
  const byCap = input.text.length > cap
  const partial = byCap || input.previewTruncated === true
  const kept = byCap ? input.text.slice(0, cap) : input.text
  // 恰好切在换行符上时,别把没带上的下一行也算进来
  const tail = kept.endsWith('\n') ? kept.slice(0, -1) : kept
  return {
    canAdd: input.canAddRef,
    code: byCap ? `${kept}……` : kept,
    startLine: 1,
    endLine: tail.split('\n').length,
    label: !input.canAddRef ? '引用已满' : partial ? '引用开头一段' : '引用全文',
    title: !input.canAddRef
      ? `一轮最多引用 ${input.refLimit} 段,想换新的先删掉一段`
      : byCap
        ? `这份代码比一轮的引用额度大,只带开头 ${cap} 字`
        : partial
          ? '这份文件太长,只带已经载入的开头一段'
          : '把这份代码整个引用到右栏对话框,接着就能问小探针'
  }
}
