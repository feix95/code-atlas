// AI 人话解释器:把文件的结构 + 关系,交给本地大模型翻译成普通人都懂的话。
// 路径契约:只认 relPath,读文件是主进程的事;这里只负责"拼提示词 + 调接口"。
// 底层不绑定任何推理服务 —— LM Studio、llama-server 都说 OpenAI 兼容的方言,
// 这里只认 ChatTarget(baseURL + 模型名),换后端不改一行业务代码。
import type { AiExplainResult, ChatTarget, FileStructure, DepGraphResult } from '../shared/types.ts'

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

/** 文件夹讲解的专属人设:只按真实清单讲,不编造不存在的文件 */
export const FOLDER_SYSTEM_PROMPT = `你是 CodeAtlas 的"代码地图导游"。
你的任务:根据 Given 一个文件夹里装了什么(子文件夹、文件、语言分布),用普通没学过编程的人也能看懂的大白话,讲清楚"这个文件夹是负责什么的、在整个项目里扮演什么角色"。
铁律:
1. 只依据 Given 的清单说话,绝不编造清单里没有的文件或功能。
2. 你的判断是推测:如果清单看不出用途,就老实说"从清单上看不出来"。
3. 不输出废话、不寒暄。用中文,短句,最多 3-5 句。`

/** 名字兜底的人设:证据不全,判断是推测,没把握要明说 */
export const GUESS_SYSTEM_PROMPT = `你是 CodeAtlas 的"代码猜猜官"。
你的任务:根据 Given 一个文件的路径、名字和内容片段,推测"这个文件大概是干什么的"。
铁律:
1. 片段只是文件的一小部分,你的判断是推测 —— 要让听的人知道哪些是有把握的、哪些是猜的。
2. 绝不编造片段里没有的函数、类或功能。
3. 不输出废话、不寒暄。用中文,短句,最多 3-4 句。`

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

/** 常见二进制/媒体后缀(小写含点):这些不是代码,不劳烦模型 */
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

/** 固定格式提示词:把一个文件夹的真实清单摆给模型,让它只翻译不编造 */
export function buildFolderPrompt(folder: {
  relPath: string
  name: string
  subdirs: string[]
  files: string[]
  /** 语言分布:语言名 → 文件数 */
  languages: Record<string, number>
}): string {
  const isRoot = folder.relPath === ''
  const langLines = Object.entries(folder.languages)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([lang, count]) => `${lang}×${count}`)
  const MAX_FILES = 100
  const MAX_SUBDIRS = 40
  const shownFiles = folder.files.slice(0, MAX_FILES)
  const shownSubdirs = folder.subdirs.slice(0, MAX_SUBDIRS)
  const lines = [
    `文件夹:${isRoot ? '(项目根目录)' : folder.relPath}`,
    `名称:${folder.name}`,
    '',
    '里面有什么:',
    `- 子文件夹(${folder.subdirs.length} 个):${shownSubdirs.join(', ')}${folder.subdirs.length > shownSubdirs.length ? ` ……(还有 ${folder.subdirs.length - shownSubdirs.length} 个没列出)` : ''}`,
    `- 文件(${folder.files.length} 个):${shownFiles.join(', ')}${folder.files.length > shownFiles.length ? ` ……(还有 ${folder.files.length - shownFiles.length} 个没列出)` : ''}`,
    `- 语言分布:${langLines.length > 0 ? langLines.join(', ') : '(没有可识别的代码文件)'}`
  ]
  return [
    ...lines,
    '',
    '请根据上面的清单,用大白话告诉我:这个文件夹是负责什么的,在整个项目里扮演什么角色。'
  ].join('\n')
}

/** 固定格式提示词:名字 + 内容片段给模型,让它推测并声明不确定的部分 */
export function buildGuessPrompt(file: { relPath: string; name: string; languageName: string; preview: string | null }): string {
  const previewText = file.preview === null
    ? '(读不出文本内容,只能凭名字和位置判断)'
    : file.preview.trim() === ''
      ? '(这是个空文件)'
      : clipPreview(file.preview)
  return [
    `文件:${file.relPath}`,
    `文件名:${file.name}`,
    `语言/类型:${file.languageName || '(没认出来)'}`,
    '',
    `内容片段(只是开头一段,不一定完整):${previewText}`,
    '',
    '请推测:这个文件大概是干什么的。片段不完整,只讲你有把握的;没把握的部分要明说"从片段看不出来",绝不许编造文件里没有的东西。'
  ].join('\n')
}

/** 片段上限:40 行 / 3000 字符,超出注明截断 */
function clipPreview(preview: string): string {
  const lines = preview.split('\n').slice(0, 40).join('\n')
  const clipped = lines.length > 3000 ? `${lines.slice(0, 3000)}\n……` : lines
  const wasCut = preview.split('\n').length > 40 || preview.length > 3000
  return wasCut ? `${clipped}\n(后面还有内容,只取了开头)` : clipped
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
export async function explainWithModel(
  config: ChatTarget,
  prompt: string,
  system: string = SYSTEM_PROMPT,
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
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ],
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
