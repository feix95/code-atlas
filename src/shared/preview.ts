// ── 代码预览的取数规矩(纯函数,自测覆盖)──
// 预览只给「够看懂」的一段:行数和字数双封顶,超了如实标截断 —— 绝不静默腰斩,
// 也不把整个大文件一口气摆到屏幕上。二进制 / 超大文件在 IPC 层就被挡住,走不到这儿。

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
