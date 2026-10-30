// 代码预览的取数规矩(纯函数,自测覆盖)
// 全文预览(2026-09-13 产品裁定):整份文本拿在手里,画面上只画一屏(虚拟滚动)——
// 滚动条是全文的行程,元素永远只有可视区那一截。原来的行数/字数两道闸防的本来就是
// 「配额表排全文」,病根除了,闸一起退役;只剩一道拒绝路径挡几百 MB 的日志怪。
// 二进制 / 超大文件在 IPC 层就被挡住,走不到这儿。

/** 超过这个体积的文本文件不预览:纯文本揣内存里不重,但几百 MB 的日志怪别请进门 */
export const PREVIEW_MAX_BYTES = 10 * 1024 * 1024

/** 图片预览的拒绝路径:整张图转 base64 dataUrl 揣内存,再大的照片墙也先挡在门外 */
export const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024

/**
 * Word 预览的拒绝路径:转换在后台线程里跑、图片落临时文件按需加载,不再整份塞进界面,
 * 所以上限可以放到截图很多的学习笔记(实测八九十 MB)也能打开;再大的先挡在门外。
 */
export const DOCX_PREVIEW_MAX_BYTES = 200 * 1024 * 1024

/** Word 解压后总量上限:按压缩包目录登记的原始大小合计,挡「解压炸弹」(与文件上限同比例,十倍) */
export const DOCX_UNZIPPED_MAX_BYTES = 2 * 1024 * 1024 * 1024

/** Word 转出来的网页上限(字符数):图片已不在网页里,只剩文字和标签,这个量足够几千页 */
export const DOCX_HTML_MAX_CHARS = 16 * 1024 * 1024

/** 单张内嵌图片上限:超过的不落盘,界面按「图片格式不支持预览」占位 */
export const DOCX_IMAGE_MAX_BYTES = 64 * 1024 * 1024

/** 一次转换最长等多久(毫秒):超时就停掉后台线程,界面给出提示 */
export const DOCX_CONVERT_TIMEOUT_MS = 3 * 60 * 1000

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
