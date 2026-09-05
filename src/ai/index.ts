// AI 人话解释器:把文件的结构 + 关系,交给本地大模型翻译成普通人都懂的话。
// 路径契约:只认 relPath,读文件是主进程的事;这里只负责"拼提示词 + 调接口"。
// 底层不绑定任何推理服务 —— LM Studio、llama-server 都说 OpenAI 兼容的方言,
// 这里只认 ChatTarget(baseURL + 模型名),换后端不改一行业务代码。
import type { AiExplainResult, AiHistoryMessage, ChatTarget, FileStructure, DepGraphResult } from '../shared/types.ts'

/** 可解释的文件结构太稀疏时,提醒模型别硬编造 */
const TOO_SPARSE_TIP = '如果上面的结构几乎是空的,就直接说这个文件里没有识别到清晰的代码结构,不要编造。'
/** 一份固定的系统人设,禁止模型自由发挥 */
const SYSTEM_PROMPT = `你是 CodeAtlas 的"代码人话翻译官"。
你的任务:把 Given 一个代码文件的结构信息,用普通没学过编程的人也能看懂的大白话,讲清楚"这个文件是干什么的、负责什么"。
铁律:
1. 只依据 Given 里给出的结构信息说话,绝不猜测、绝不编造结构里没有的东西。
2. 不输出废话、不寒暄、不重复要点。
3. 用中文,短句,最多 3-5 句。像跟朋友讲解一样自然。
4. 如果结构信息太少看不出用途,就诚实说"看不出这个文件具体做什么",并说说你唯一能确定的点。`

/** git 改动翻译的专属人设:只讲 diff 里真实发生的改动 */
export const DIFF_SYSTEM_PROMPT = `你是 CodeAtlas 的"代码改动翻译官"。
你的任务:把 Given 的一次代码改动(git diff),用普通没学过编程的人也能看懂的大白话,讲清楚"这次改了什么、大概为什么改、会影响哪里"。
铁律:
1. 只依据 Given 里的 diff 内容说话,绝不猜测、绝不编造 diff 里没有的改动。
2. 不输出废话、不寒暄。
3. 用中文,短句,最多 3-5 句。
4. 如果改动太碎看不出意图,就老实说"这是一批小调整",再挑你最有把握的一两点讲。`

/** 文件夹讲解的专属人设:只按真实清单讲,不编造不存在的文件;认得系统目录就用常识;信息再少也不许一句摆烂 */
export const FOLDER_SYSTEM_PROMPT = `你是 CodeAtlas 的"代码地图导游"。
你的任务:根据 Given 一个文件夹的信息(完整路径、里面装了什么、文件类型分布),用普通没学过编程的人也能看懂的大白话,讲清楚"这个文件夹是干什么的"。
铁律:
1. 只依据 Given 的信息说话,绝不编造清单里没有的文件或功能。
2. 用户可能在浏览自己电脑的任意磁盘,不一定是开发项目:如果完整路径是知名系统目录或知名软件的安装目录(比如 Program Files、Windows、AppData、Users),直接用你已知的常识介绍它是干什么的,不用假装只能从文件清单瞎猜。
3. 你的判断是推测,但不许只回一句"看不出来"敷衍了事。即使清单信息很少,也要:
   a) 先说说你观察到的具体线索(文件夹叫什么名字、里面文件的名字和后缀是什么);
   b) 结合这些线索给出一个合理推测(哪怕只是"这类命名常见于XX场景"这种方向性判断),并说明这是推测、不是确定;
   c) 只有连文件夹名字和文件名本身都毫无辨识度(比如纯随机字符命名)时,才可以说"这个我也认不出具体用途",但依然要把观察到的文件名念出来,不能连线索都不说一句。
4. 不输出废话、不寒暄。用中文,短句,最多 3-5 句。`

/** 名字兜底的人设:证据不全,判断是推测,没把握要明说;认得系统目录就用常识 */
export const GUESS_SYSTEM_PROMPT = `你是 CodeAtlas 的"代码猜猜官"。
你的任务:根据 Given 一个文件的完整路径、名字和内容片段,推测"这个文件大概是干什么的"。
铁律:
1. 片段只是文件的一小部分,你的判断是推测 —— 要让听的人知道哪些是有把握的、哪些是猜的。
2. 绝不编造片段里没有的函数、类或功能。
3. 如果完整路径一看就是系统目录或知名软件的地盘(比如 Windows、Program Files、AppData),直接用你已知的常识介绍这类文件是干什么的,不用假装只能凭片段瞎猜。
4. 不输出废话、不寒暄。用中文,短句,最多 3-4 句。`

/**
 * 追问的专属人设:讲解之后的"能不能删、删了会怎样"这类行动问题归它答。
 * 分寸:敢给明确倾向,不拿"咨询专业人士"打太极;但系统关键地盘必须劝阻;
 * 建议"能删"时顺手带低成本安全网;真没把握就老实承认,不装懂。
 */
export const CHAT_SYSTEM_PROMPT = `你是 CodeAtlas 的"追问答疑官"。用户看过一段讲解后继续追问,常问"这个能删吗、删了会有什么影响、这是什么软件留下的"。
你的任务:结合 Given 的资料(完整路径、清单/结构、之前的对话)和常识,正面回答,给普通人能落地的建议。
铁律:
1. 只依据 Given 的资料和常识说话,绝不编造资料里没有的东西。
2. 敢给明确倾向:能判断就直说(比如"这类残留文件夹通常删了不影响系统运行"),不许用"建议咨询专业人士"这种没有信息量的车轱辘话敷衍。
3. 涉及系统关键地盘(Windows、Program Files、System32 这类系统目录内部)要明确劝阻:这些是系统和软件的家,删了可能开不了机或坏掉软件,别怂恿用户删。
4. 建议"可以删"时,顺手带一句低成本保险做法:"先移到回收站,观察几天没问题再清空",不许空喊"建议谨慎"。
5. 真没把握判断安全性,就老实说"这个我也判断不了,建议你自己搜一下确认",不许装懂。
6. 不输出废话、不寒暄。用中文,短句,最多 5 句。`

/** 追问历史的上限:本地模型上下文只有 4096,证据每轮都要全量重摆,历史只留最近几条垫底 */
const CHAT_HISTORY_MAX = 5
const CHAT_HISTORY_CONTENT_MAX = 500

/** 渲染进程传来的历史先洗干净:只收 user/assistant 两条腿,条数和单条长度都封顶,防提示词被撑爆 */
export function sanitizeHistory(history: unknown): AiHistoryMessage[] {
  if (!Array.isArray(history)) return []
  const cleaned: AiHistoryMessage[] = []
  for (const item of history) {
    if (typeof item !== 'object' || item === null) continue
    const { role, content } = item as { role?: unknown; content?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue
    const text = content.trim()
    if (!text) continue
    cleaned.push({ role, content: text.length > CHAT_HISTORY_CONTENT_MAX ? `${text.slice(0, CHAT_HISTORY_CONTENT_MAX)}……` : text })
    if (cleaned.length >= CHAT_HISTORY_MAX) break
  }
  return cleaned
}

/**
 * 组追问的消息序列:证据永远当第一条用户消息重摆(模型不失忆的根),
 * 历史问答跟在后面,当前问题收尾。相邻同角色合并成一条 —— 首问不带讲解直问时,
 * 证据和首个问题会连成两条 user,拼回一条才跟当时的真实对话形态一致,也不挑聊天模板。
 */
export function buildChatMessages(
  system: string,
  evidence: string,
  history: AiHistoryMessage[],
  question: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: system },
    { role: 'user', content: evidence },
    ...history,
    { role: 'user', content: `用户的问题:${question}` }
  ]
  const merged: typeof messages = []
  for (const msg of messages) {
    const last = merged[merged.length - 1]
    if (last && last.role === msg.role) last.content = `${last.content}\n\n${msg.content}`
    else merged.push({ ...msg })
  }
  return merged
}

/**
 * 联网查证的信号词(可选功能,默认关):只在整个功能开启时才把这句补充要求附在
 * 证据后面,让模型"认出像某个软件但说不准是谁"时打一个信号,不搞复杂的置信度打分。
 */
export const WEB_SIGNAL_INSTRUCTION =
  '\n\n(补充要求:如果你认出这些名字像是某个具体软件/品牌留下的,但说不准它到底是谁,就在回答的最后单独一行写「需要联网确认」,其余内容照常讲。如期能认出来,就不要写这行。)'

/** 讲解回答里带没带联网信号 */
export function hasWebLookupSignal(answer: string): boolean {
  return answer.includes('需要联网确认')
}

/**
 * 组「联网修正」的消息:原对话(证据+首答)垫底,联网资料作为新的用户消息进场,
 * 让模型重新给一版更准确的结论;资料对不上就基本维持原话,不硬编。
 */
export function buildRefineMessages(
  system: string,
  evidence: string,
  firstAnswer: string,
  material: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    { role: 'system', content: system },
    { role: 'user', content: evidence },
    { role: 'assistant', content: firstAnswer },
    {
      role: 'user',
      content:
        `这是刚联网查到的公开资料:\n${material}\n\n` +
        '请结合资料,把上面那段讲解修正成更准确的一版:说得清是什么软件/品牌就明说;资料对不上或没帮助,就基本维持原话,别硬编。' +
        '不要写「需要联网确认」这个标记,直接给修正后的结论。'
    }
  ]
}

function formatStructureLines(structure: FileStructure): string[] {
  const lines: string[] = []
  if (structure.functions.length > 0) lines.push(`函数:${structure.functions.join(', ')}`)
  if (structure.classes.length > 0) lines.push(`类:${structure.classes.join(', ')}`)
  if (structure.interfaces.length > 0) lines.push(`接口/类型:${structure.interfaces.join(', ')}`)
  if (structure.reactComponents.length > 0) lines.push(`React 组件:${structure.reactComponents.join(', ')}`)
  if (structure.imports.length > 0) lines.push(`导入:${structure.imports.join(', ')}`)
  if (structure.exports.length > 0) lines.push(`导出:${structure.exports.join(', ')}`)
  return lines
}

function formatRelationLine(relPath: string, graph: DepGraphResult | null): string {
  if (!graph) return ''
  const importers = graph.edges.filter((edge) => edge.to === relPath).map((edge) => edge.from)
  const dependencies = graph.edges.filter((edge) => edge.from === relPath).map((edge) => edge.to)
  if (importers.length === 0 && dependencies.length === 0) return ''
  const parts: string[] = []
  if (importers.length > 0) parts.push(`被这些文件用:${importers.join(', ')}`)
  if (dependencies.length > 0) parts.push(`它引用了:${dependencies.join(', ')}`)
  return `关系:${parts.join(';')}`
}

/** 固定格式提示词:把证据摆给模型,让它只翻译不编造 */
export function buildExplainPrompt(file: {
  relPath: string
  name: string
  languageName: string
  structure: FileStructure
  graph: DepGraphResult | null
}): string {
  const structureLines = [...formatStructureLines(file.structure), TOO_SPARSE_TIP]
  const relationLine = formatRelationLine(file.relPath, file.graph)
  return [
    `文件:${file.relPath}`,
    `语言:${file.languageName}`,
    '',
    '结构信息:',
    ...structureLines.map((line) => `- ${line}`),
    '',
    relationLine,
    '',
    '请根据上面的结构信息,用大白话告诉我:这个文件是干什么的,负责什么。'
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** 改动种类 → 人话(提示词和界面共用一份口径) */
export function gitKindName(kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'): string {
  const names: Record<typeof kind, string> = {
    added: '新增',
    modified: '修改',
    deleted: '删除',
    renamed: '重命名',
    untracked: '新文件'
  }
  return names[kind]
}

/** 常见二进制/媒体后缀(小写含点):这些读不出文本,走「文件头认类型」那一支 */
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tif', '.tiff',
  '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.lib', '.class', '.jar', '.pyc', '.wasm',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.wav', '.flac', '.ogg', '.mp4', '.avi', '.mov', '.mkv', '.webm',
  '.psd', '.ai', '.sketch', '.db', '.sqlite', '.sqlite3', '.dat'
])

/** 按文件名判断是不是二进制/媒体文件(svg 是文本,不算) */
export function isBinaryFile(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false // 无后缀或隐藏文件(如 .gitignore)不当二进制
  return BINARY_EXTS.has(name.slice(dot).toLowerCase())
}

/** 固定格式提示词:把一个文件夹的真实清单摆给模型,让它只翻译不编造;完整路径帮它认出系统目录 */
export function buildFolderPrompt(folder: {
  relPath: string
  name: string
  /** 完整路径(项目根 + relPath):模型靠它认出系统目录、知名软件目录 */
  absPath: string
  subdirs: string[]
  files: string[]
  /** 语言分布:语言名 → 文件数(只统计认得出的编程语言) */
  languages: Record<string, number>
  /** 通用后缀分布:后缀 → 文件数(什么文件都数,.exe/.dll/.log 这些是认系统文件夹的关键证据) */
  extCounts: Record<string, number>
}): string {
  const isRoot = folder.relPath === ''
  const langLines = Object.entries(folder.languages)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([lang, count]) => `${lang}×${count}`)
  const MAX_EXTS = 15
  const extEntries = Object.entries(folder.extCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const extLines = extEntries.slice(0, MAX_EXTS).map(([ext, count]) => `${ext}×${count}`)
  const hiddenExts = extEntries.length - extLines.length
  const extText =
    extLines.length > 0 ? `${extLines.join(', ')}${hiddenExts > 0 ? ` ……(还有 ${hiddenExts} 种)` : ''}` : '(这个文件夹没有文件)'
  const MAX_FILES = 100
  const MAX_SUBDIRS = 40
  const shownFiles = folder.files.slice(0, MAX_FILES)
  const shownSubdirs = folder.subdirs.slice(0, MAX_SUBDIRS)
  const lines = [
    `文件夹:${isRoot ? '(项目根目录)' : folder.relPath}`,
    `完整路径:${folder.absPath}`,
    `名称:${folder.name}`,
    '',
    '里面有什么:',
    `- 子文件夹(${folder.subdirs.length} 个):${shownSubdirs.join(', ')}${folder.subdirs.length > shownSubdirs.length ? ` ……(还有 ${folder.subdirs.length - shownSubdirs.length} 个没列出)` : ''}`,
    `- 文件(${folder.files.length} 个):${shownFiles.join(', ')}${folder.files.length > shownFiles.length ? ` ……(还有 ${folder.files.length - shownFiles.length} 个没列出)` : ''}`,
    `- 语言分布:${langLines.length > 0 ? langLines.join(', ') : '(没有可识别的代码文件)'}`,
    `- 文件类型分布(按后缀统计,什么文件都算):${extText}`
  ]
  return [
    ...lines,
    '',
    '请用大白话告诉我:这个文件夹是干什么的。完整路径如果一看就是系统目录或知名软件的地盘(比如 Windows、Program Files、AppData),直接用你已知的常识介绍它;不是的话,再按清单推测它在项目里扮演什么角色。'
  ].join('\n')
}

/** 固定格式提示词:完整路径 + 名字 + 内容片段给模型,让它推测并声明不确定的部分 */
export function buildGuessPrompt(file: {
  relPath: string
  name: string
  /** 完整路径:模型靠它认出系统目录、知名软件目录 */
  absPath: string
  languageName: string
  preview: string | null
}): string {
  const previewText = file.preview === null
    ? '(读不出文本内容,只能凭名字和位置判断)'
    : file.preview.trim() === ''
      ? '(这是个空文件)'
      : clipPreview(file.preview)
  return [
    `文件:${file.relPath}`,
    `完整路径:${file.absPath}`,
    `文件名:${file.name}`,
    `语言/类型:${file.languageName || '(没认出来)'}`,
    '',
    `内容片段(只是开头一段,不一定完整):${previewText}`,
    '',
    '请推测:这个文件大概是干什么的。完整路径如果一看就是系统目录或知名软件的地盘,直接用你已知的常识介绍;否则按名字和片段推测。只讲你有把握的;没把握的部分要明说"从片段看不出来",绝不许编造文件里没有的东西。'
  ].join('\n')
}

/** 片段上限:40 行 / 3000 字符,超出注明截断 */
function clipPreview(preview: string): string {
  const lines = preview.split('\n').slice(0, 40).join('\n')
  const clipped = lines.length > 3000 ? `${lines.slice(0, 3000)}\n……` : lines
  const wasCut = preview.split('\n').length > 40 || preview.length > 3000
  return wasCut ? `${clipped}\n(后面还有内容,只取了开头)` : clipped
}

/** 文件头认出的类型(真证据):type 是人话,dims 是图片尺寸(认得出才给) */
export interface BinaryKind {
  type: string
  dims?: string
}

/** 固定格式提示词:二进制文件读不出文字,把文件头认出的类型当全部证据,推测 + 声明不确定 */
export function buildBinaryPrompt(file: { relPath: string; name: string; typeInfo: string; sizeText: string }): string {
  const seesName = file.name && file.name !== file.relPath
  return [
    `文件:${file.relPath}`,
    ...(seesName ? [`文件名:${file.name}`] : []),
    `类型识别(读文件头认出来的):${file.typeInfo}`,
    `大小:${file.sizeText}`,
    '',
    '这是二进制文件,读不出文字内容,上面的类型线索就是全部证据。',
    '请用大白话讲:1) 这种类型的文件一般是干什么的;2) 结合名字和路径,推测它在这个项目里可能扮演什么角色。',
    '开头要说明"以下是按类型和大小做的推测,没有看到文件内容";没把握的直接说不确定,绝不许编造文件里有什么具体内容。'
  ].join('\n')
}

/** 读文件头几十字节的魔数认类型;认不出返回 null(name 只用来细分 ZIP 家族) */
export function sniffBinaryKind(header: Buffer, name: string): BinaryKind | null {
  // 认魔数最少要 2 字节 —— MZ(EXE) 就 2 字节,其余格式都 ≥3;再短没法认
  if (header.length < 2) return null
  const starts = (...bytes: number[]): boolean => bytes.every((b, i) => header[i] === b)
  const ascii = (offset: number, text: string): boolean => {
    if (header.length < offset + text.length) return false
    return header.subarray(offset, offset + text.length).toString('latin1') === text
  }

  // 图片:连尺寸一起认(宽×高)
  if (starts(0x89, 0x50, 0x4e, 0x47)) {
    return header.length >= 24
      ? { type: 'PNG 图片', dims: `${header.readUInt32BE(16)}×${header.readUInt32BE(20)}` }
      : { type: 'PNG 图片' }
  }
  if (starts(0xff, 0xd8, 0xff)) return { type: 'JPEG 图片', dims: jpegDims(header) }
  if (ascii(0, 'GIF8')) return header.length >= 10 ? { type: 'GIF 图片', dims: `${header.readUInt16LE(6)}×${header.readUInt16LE(8)}` } : { type: 'GIF 图片' }
  if (ascii(0, 'BM') && header.length >= 26) return { type: 'BMP 图片', dims: `${header.readUInt32LE(18)}×${header.readUInt32LE(22)}` }
  if (starts(0, 0, 1, 0)) return { type: 'ICO 图标' }
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { type: 'WebP 图片' }

  // 音视频
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return { type: 'WAV 音频' }
  if (ascii(0, 'RIFF') && ascii(8, 'AVI ')) return { type: 'AVI 视频' }
  if (ascii(4, 'ftyp')) return { type: `MP4 视频(${header.subarray(8, 12).toString('latin1').trim()} 格式)` }
  if (ascii(0, 'ID3') || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)) return { type: 'MP3 音频' }
  if (ascii(0, 'OggS')) return { type: 'OGG 音频' }
  if (ascii(0, 'fLaC')) return { type: 'FLAC 无损音频' }

  // 文档/压缩包
  if (ascii(0, '%PDF')) return { type: 'PDF 文档' }
  if (ascii(0, 'PK\x03\x04')) return { type: zipFamily(name) }
  if (ascii(0, 'Rar!')) return { type: 'RAR 压缩包' }
  if (starts(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return { type: '7Z 压缩包' }
  if (starts(0x1f, 0x8b)) return { type: 'GZIP 压缩(多半是 .tar.gz)' }

  // 程序/数据
  if (ascii(0, 'MZ')) return { type: 'Windows 可执行文件或库(EXE/DLL)' }
  if (starts(0x7f, 0x45, 0x4c, 0x46)) return { type: 'Linux 可执行文件(ELF)' }
  if (ascii(0, 'SQLite format 3')) return { type: 'SQLite 数据库' }
  if (starts(0, 0x61, 0x73, 0x6d)) return { type: 'WebAssembly 模块' }
  return null
}

/** ZIP 是个万能容器:按后缀细分家族,细分不出的叫压缩包 */
function zipFamily(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : ''
  if (ext === '.docx') return 'Word 文档(Office 打包格式)'
  if (ext === '.xlsx') return 'Excel 表格(Office 打包格式)'
  if (ext === '.pptx') return 'PowerPoint 幻灯片(Office 打包格式)'
  if (ext === '.jar') return 'Java 归档包(JAR)'
  if (ext === '.apk') return '安卓安装包(APK)'
  return 'ZIP 压缩包'
}

/** JPEG 尺寸藏在 SOF 标记里:顺着标记链走,长度段的标记跳过去 */
function jpegDims(header: Buffer): string | undefined {
  let pos = 2
  while (pos + 9 < header.length) {
    if (header[pos] !== 0xff) {
      pos++
      continue
    }
    const marker = header[pos + 1]
    // 这些标记不带长度段,直接跳两个字节
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      pos += 2
      continue
    }
    const len = header.readUInt16BE(pos + 2)
    // SOF0~SOF15 才带尺寸;0xC4(DHT)/0xC8(JPG)/0xCC(DAC) 长得像但不是
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return `${header.readUInt16BE(pos + 7)}×${header.readUInt16BE(pos + 5)}`
    }
    pos += 2 + len
  }
  return undefined
}

/** 固定格式提示词:把一次改动的 diff 摆给模型,让它只翻译不编造 */
export function buildDiffPrompt(change: { relPath: string; kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'; diff: string }): string {
  const evidence = change.diff.trim()
    ? `改动内容(git diff):\n${change.diff}`
    : '改动内容:(空的,没有可逐行对比的内容。如果没有任何改动信息,直接说看不出这次改了什么,不要编造。)'
  return [
    `文件:${change.relPath}`,
    `改动类型:${gitKindName(change.kind)}`,
    '',
    evidence,
    '',
    '请根据上面的改动内容,用大白话告诉我:这次改动做了什么,大概会影响哪里。'
  ].join('\n')
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

interface ChatStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>
}

/**
 * 解析 OpenAI 流式(SSE)响应体,逐段吐出新增文本。
 * 格式:每行 `data: {json}`,`data: [DONE]` 收尾;残帧(半个 JSON)留到下一轮。
 */
async function* sseContentDeltas(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // 最后一段可能是残行,留给下一块
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        const chunk = JSON.parse(payload) as ChatStreamChunk
        const piece = chunk.choices?.[0]?.delta?.content
        if (piece) yield piece
      } catch {
        // 残帧或心跳,跳过
      }
    }
  }
}

/** 等响应头的耐心(模型加载/排队可能很久,首次可达一分钟以上) */
const HEADERS_TIMEOUT_MS = 120_000
/** 非流式:读完整回复的耐心 */
const BODY_TIMEOUT_MS = 120_000
/** 流式:两次增量之间超过这么久没动静,判定模型卡住,掐断别让界面干等 */
const STREAM_IDLE_MS = 30_000

/**
 * 调 OpenAI 兼容接口(ChatTarget),拿到人话解释。
 * 传 onDelta = 流式:边生成边推送增量(内置大模型生成慢,流式不用干瞪眼);
 * 不传 = 老行为,等全量。两条路 LM Studio 和内置模型都支持。
 * 超时是分段看门狗:等响应头/整段回复给足耐心;流式只要还有增量就一直续命,
 * 一旦没动静立刻掐断 —— 绝不无限挂死,也不把慢模型的正常输出拦腰砍断。
 * signal = 外部取消(用户换了讲解目标):立刻掐,不让过气的生成占着模型排队。
 * 能力边界:服务不通、超时、返回空,都给 status='error' 的人话,不抛异常。
 */
export async function explainWithMessages(
  config: ChatTarget,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onDelta?: (text: string) => void,
  signal?: AbortSignal
): Promise<AiExplainResult> {
  const startedAt = Date.now()
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const controller = new AbortController()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const armWatchdog = (ms: number): void => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => controller.abort(), ms)
  }
  let full = ''
  try {
    armWatchdog(HEADERS_TIMEOUT_MS)
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: 500,
        stream: Boolean(onDelta)
      }),
      signal: controller.signal
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return {
        status: 'error',
        text: `模型服务返回错误(${res.status})${detail ? `:${detail.slice(0, 120)}` : ''}`,
        model: config.model,
        durationMs: Date.now() - startedAt
      }
    }

    if (!onDelta) {
      armWatchdog(BODY_TIMEOUT_MS)
      const data = (await res.json()) as ChatCompletionResponse
      const content = data.choices?.[0]?.message?.content?.trim()
      if (!content) {
        return { status: 'error', text: '模型没有返回内容,可能没加载成功', model: config.model, durationMs: Date.now() - startedAt }
      }
      return { status: 'supported', text: content, model: config.model, durationMs: Date.now() - startedAt }
    }

    // 流式:逐段喂给 onDelta,全文攒到最后一起返回
    armWatchdog(STREAM_IDLE_MS)
    for await (const piece of sseContentDeltas(res)) {
      full += piece
      armWatchdog(STREAM_IDLE_MS) // 还有增量,继续续命
      onDelta(piece)
    }
    if (!full.trim()) {
      return { status: 'error', text: '模型没有返回内容,可能没加载成功', model: config.model, durationMs: Date.now() - startedAt }
    }
    return { status: 'supported', text: full, model: config.model, durationMs: Date.now() - startedAt }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    // 卡住前已经吐了一部分:把到手的先给用户,别一把全扔
    if (isAbort && full.trim()) {
      return {
        status: 'supported',
        text: `${full}\n\n(回答到这儿断了:模型可能卡住了,再点一次可以重讲)`,
        model: config.model,
        durationMs: Date.now() - startedAt
      }
    }
    const msg = isAbort
      ? '模型响应超时,可能模型还在加载,或太大跑不动'
      : `连不上模型服务,检查模型服务是否已启动(${baseUrl})`
    return { status: 'error', text: msg, model: config.model, durationMs: Date.now() - startedAt }
  } finally {
    clearTimeout(watchdog)
  }
}

/** 单轮讲解的老入口:人设 + 一条证据消息。追问等多轮场景直接用 explainWithMessages */
export async function explainWithModel(
  config: ChatTarget,
  prompt: string,
  system: string = SYSTEM_PROMPT,
  onDelta?: (text: string) => void,
  signal?: AbortSignal
): Promise<AiExplainResult> {
  return explainWithMessages(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    onDelta,
    signal
  )
}
