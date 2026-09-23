// ── 后缀总账:「什么后缀算什么类」一本账 ──
// parser/ai/scanner/summarizer 都从这里查,不许再各养一本名单 ——
// 两本名单必漂移(漂移现场:BINARY_EXTS 曾在 parser/ai 各养一本,漏了 .docx/.gguf 等
// 几十个后缀,预览把二进制当文本读出一屏乱码)。
// 语言户口本(语言→后缀)在 shared/languages.ts;语法 wasm 账在 shared/grammarWasm.ts。

/**
 * 已知二进制/媒体后缀(小写含点):内容必是字节流,读不出文本。
 * 命中 = parser 不嗅探、预览/agent 不当文本读,一律走「文件头认类型」那一支。
 * 注意只收纯二进制:svg 是文本、ts 是 TypeScript,都不在列;.dat 偶有文本
 * 但按二进制对待更安全(宁少识别,不读出乱码)。
 */
export const BINARY_EXTS = new Set([
  // 图片
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.tif',
  '.tiff',
  '.psd',
  '.heic',
  '.ai',
  // 音频
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.m4a',
  '.aac',
  '.opus',
  '.wma',
  '.mid',
  '.midi',
  // 视频
  '.mp4',
  '.m4v',
  '.mkv',
  '.avi',
  '.mov',
  '.webm',
  '.wmv',
  '.flv',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.vob',
  // 字体
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  // 压缩包
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.zst',
  '.lz4',
  '.br',
  // 编译产物 / 机器码
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.o',
  '.obj',
  '.a',
  '.lib',
  '.wasm',
  '.class',
  '.jar',
  '.pyc',
  '.pyd',
  // 二进制文档 / 数据库 / 磁盘镜像 / 设计稿 / 杂项数据
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.iso',
  '.dmg',
  '.img',
  '.sketch',
  '.dat',
  // 大模型权重(本项目 vendor/ 里就有,体积动辄几个 GB)
  '.gguf',
  '.safetensors',
  '.onnx',
  '.pt',
  '.pth'
])

/**
 * 文档类后缀(小写含点):可当文档对待 ——
 * scanner 会嗅开头第一行当标题;summarizer 认它评「全是文档,没有代码」。
 * .rst/.adoc 的首行往往也是标题文本,嗅了不亏。
 */
export const DOC_EXTS = new Set(['.md', '.markdown', '.txt', '.rst', '.adoc'])

/** 按文件名判断是不是二进制/媒体文件(svg 是文本,不算;无后缀/.gitignore 这类隐藏文件也不算) */
export function isBinaryFile(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false // 无后缀或隐藏文件(如 .gitignore)不当二进制
  return BINARY_EXTS.has(name.slice(dot).toLowerCase())
}
