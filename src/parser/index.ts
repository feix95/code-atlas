import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import type { LanguageTag } from '../shared/types.ts'
import { BY_EXT, BY_FILENAME, LANGUAGES, type LanguageDef } from './languages.ts'

const ALL_BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]))

/** 嗅探只读文件开头这么多字节,够认语言了 */
const SNIFF_BYTES = 4096

/** 比这更大的文件不嗅探:源代码不可能这么大,多半是数据/媒体,认不出就认不出 */
const MAX_SNIFF_FILE_BYTES = 5 * 1024 * 1024

/**
 * 已知二进制类后缀:内容必是字节流,嗅探也认不出语言。
 * 命中直接返回 null,零 I/O —— 不然每个视频都得整只读进内存才能"发现"它是二进制。
 * 注意只收纯二进制:svg 是文本、ts 是 TypeScript,都不在列。
 */
const BINARY_EXTS = new Set([
  // 图片
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tif', '.tiff', '.psd', '.heic',
  // 音频
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus', '.wma', '.mid', '.midi',
  // 视频
  '.mp4', '.m4v', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.flv', '.mpg', '.mpeg', '.3gp', '.vob',
  // 字体
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // 压缩包
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar', '.zst', '.lz4', '.br',
  // 编译产物 / 机器码
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.obj', '.lib', '.wasm', '.class', '.jar',
  '.pyc', '.pyd',
  // 二进制文档 / 数据库 / 磁盘镜像
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.db', '.sqlite', '.sqlite3',
  '.iso', '.dmg', '.img',
  // 大模型权重(本项目 vendor/ 里就有,体积动辄几个 GB)
  '.gguf', '.safetensors', '.onnx', '.pt', '.pth'
])

/** UTF-8 BOM:文件开头可能出现,识别前要去掉 */
const BOM = String.fromCharCode(0xfeff)

function tagOf(lang: LanguageDef, source: LanguageTag['source']): LanguageTag {
  return { id: lang.id, name: lang.name, source }
}

/** 按后缀/特殊文件名速查;认不出返回 null(不读文件) */
export function identifyByExtension(fileName: string): LanguageTag | null {
  const lower = fileName.toLowerCase()
  const byName = BY_FILENAME.get(lower)
  if (byName) return tagOf(byName, 'extension')
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return null // 无后缀(或就是 . 开头的隐藏文件)
  const byExt = BY_EXT.get(lower.slice(dot))
  return byExt ? tagOf(byExt, 'extension') : null
}

/** shebang 第一行:`#!/usr/bin/env python3` 之类 */
const SHEBANG_PATTERNS: Array<[RegExp, string]> = [
  [/python\d?/, 'python'],
  [/\bnode\b/, 'javascript'],
  [/\b(ba|z|da)?sh\b/, 'shell'],
  [/\bruby\b/, 'ruby'],
  [/\bphp\b/, 'php'],
  [/\b(pwsh|powershell)\b/, 'powershell']
]

interface ContentRule {
  re: RegExp
  w: number
}

/**
 * 内容特征打分表:只在后缀认不出时上场。
 * TypeScript / C++ 的规则只写"各自独有"的特征,算分时叠加在 JS / C 的底分上再比较。
 */
const CONTENT_RULES: Record<string, ContentRule[]> = {
  javascript: [
    { re: /\b(function|const|let|var)\b/, w: 1 },
    { re: /=>/, w: 1 },
    { re: /console\.log/, w: 1.5 },
    { re: /\brequire\(|module\.exports/, w: 1.5 }
  ],
  typescript: [
    { re: /\binterface\s+\w+\s*\{/, w: 2 },
    { re: /:\s*(string|number|boolean|any|void)\b/, w: 1.5 },
    { re: /\btype\s+\w+\s*=/, w: 1.5 },
    { re: /\bimport\s+type\b/, w: 2 },
    { re: /\bas\s+(const|unknown)\b/, w: 1.5 }
  ],
  python: [
    { re: /^\s*def\s+\w+\s*\(.*\)\s*:\s*$/m, w: 2 },
    { re: /^\s*(import\s+\w+|from\s+\w+\s+import\b)/m, w: 1 },
    { re: /__name__\s*==/, w: 2 }
  ],
  go: [
    { re: /^package\s+\w+/m, w: 3 },
    { re: /^func\s+(\([^)]*\)\s*)?\w+\(/m, w: 2 },
    { re: /\bfmt\./, w: 1 }
  ],
  rust: [
    { re: /\bfn\s+\w+\s*\(/, w: 2 },
    { re: /\blet\s+mut\b/, w: 2 },
    { re: /println!|vec!|match\s+\w+\s+\{/, w: 2 }
  ],
  java: [
    { re: /\bpublic\s+(class|interface|enum)\s+\w+/, w: 3 },
    { re: /System\.out\.print/, w: 2 },
    { re: /\bprivate\s+(final\s+)?\w+\s+\w+\s*;/, w: 1 }
  ],
  csharp: [
    { re: /\busing\s+System/, w: 2.5 },
    { re: /\bnamespace\s+[\w.]+/, w: 1.5 },
    { re: /\bConsole\.Write/, w: 2 }
  ],
  c: [
    { re: /#include\s*[<"]/, w: 2 },
    { re: /\bprintf\s*\(/, w: 1.5 },
    { re: /\bstruct\s+\w+\s*\{/, w: 1 }
  ],
  cpp: [
    { re: /\bstd::/, w: 2 },
    { re: /\bcout\s*<</, w: 2 },
    { re: /\btemplate\s*</, w: 1.5 }
  ],
  shell: [
    { re: /\bif\s+\[.*\];?\s*then/, w: 2 },
    { re: /\becho\s+\$/, w: 1 },
    { re: /^\s*fi\s*$/m, w: 1.5 }
  ],
  ruby: [
    { re: /\bdef\s+\w+/, w: 1 },
    { re: /\bputs\s/, w: 1.5 },
    { re: /^\s*end\s*$/m, w: 1 }
  ],
  php: [{ re: /<\?php/, w: 4 }],
  yaml: [
    { re: /^---\s*$/m, w: 2 },
    { re: /^[\w-]+:\s*(\S.*)?$/m, w: 1.5 }
  ],
  markdown: [
    { re: /^#{1,6}\s+\S/m, w: 1.5 },
    { re: /^```/m, w: 1.5 },
    { re: /\[[^\]]+\]\([^)]+\)/, w: 1 }
  ],
  html: [
    { re: /<html[\s>]|<!DOCTYPE\s+html/i, w: 3 },
    { re: /<\/(div|body|head|p|span)>/, w: 2 }
  ],
  xml: [{ re: /<\?xml/, w: 3 }],
  css: [
    { re: /[.#]?[\w-]+\s*\{[^{}]*:[^{}]*\}/, w: 1.5 },
    { re: /@(media|import|keyframes|font-face)\b/, w: 1.5 }
  ]
}

/**
 * 靠内容认语言(纯函数,不碰文件系统)。
 * 返回 null = 认不出(二进制或特征不明),调用方按"无语言"处理。
 */
export function identifyFromContent(_fileName: string, head: Buffer): LanguageTag | null {
  // 含 \0 字节基本就是二进制(图片、编译产物),不当文本猜
  if (head.includes(0)) return null
  const text = head.toString('utf8').replace(new RegExp('^' + BOM), '')

  // 第一优先:shebang
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n')).trim()
  if (firstLine.startsWith('#!')) {
    for (const [pattern, id] of SHEBANG_PATTERNS) {
      if (pattern.test(firstLine)) {
        const lang = find(id)
        return lang ? tagOf(lang, 'content') : null
      }
    }
  }

  // 各语言打分
  const scores: Record<string, number> = {}
  for (const [id, rules] of Object.entries(CONTENT_RULES)) {
    let s = 0
    for (const rule of rules) {
      if (rule.re.test(text)) s += rule.w
    }
    if (s > 0) scores[id] = s
  }

  // JSON 单独验:结构能被解析才算
  const trimmed = text.trim()
  if (/^[{[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed)
      scores['json'] = (scores['json'] ?? 0) + 4
    } catch {
      // 截断的 JSON 解析不了,正常,按其他线索走
    }
  }

  // TS = JS 底分 + TS 独有特征;特征一分没有就不冒充 TS
  if ((scores['typescript'] ?? 0) > 0) {
    scores['typescript'] += scores['javascript'] ?? 0
  } else {
    delete scores['typescript']
  }
  // C++ = C 底分 + C++ 独有特征
  if ((scores['cpp'] ?? 0) > 0) {
    scores['cpp'] += scores['c'] ?? 0
  } else {
    delete scores['cpp']
  }

  let best: string | null = null
  let bestScore = 0
  for (const [id, s] of Object.entries(scores)) {
    if (s > bestScore) {
      best = id
      bestScore = s
    }
  }
  if (!best) {
    // 实在认不出:纯文本兜底,但空文件不算
    return text.trim() === '' ? null : tagOf(find('text'), 'content')
  }
  return tagOf(find(best), 'content')
}

/** 完整识别:后缀速查优先(零 I/O),认不出才读开头 4KB 嗅探 */
export async function identifyFileLanguage(
  filePath: string,
  fileName: string
): Promise<LanguageTag | null> {
  const byExt = identifyByExtension(fileName)
  if (byExt) return byExt

  // 已知二进制:连文件都不用开,必无语言
  const lower = fileName.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot > 0 && BINARY_EXTS.has(lower.slice(dot))) return null

  // 真·只读文件开头:fs.open + read,拿多少字节是多少,
  // 绝不 fs.readFile 把整只文件(几个 GB 的视频)读进内存
  let handle: FileHandle
  try {
    handle = await fs.open(filePath, 'r')
  } catch {
    return null // 打不开(无权限等):认不出,不炸
  }
  try {
    const size = (await handle.stat()).size
    if (size > MAX_SNIFF_FILE_BYTES) return null
    const buf = Buffer.alloc(Math.min(SNIFF_BYTES, size))
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    if (bytesRead === 0) return null
    return identifyFromContent(fileName, buf.subarray(0, bytesRead))
  } catch {
    return null
  } finally {
    await handle.close().catch(() => {})
  }
}

function find(id: string): LanguageDef {
  const def = ALL_BY_ID.get(id)
  if (!def) throw new Error(`未注册的语言:${id}`)
  return def
}
