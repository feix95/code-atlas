// AI 人话解释器:把文件的结构 + 关系,交给本地大模型翻译成普通人都懂的话。
// 路径契约:只认 relPath,读文件是主进程的事;这里只负责"拼提示词 + 调接口"。
import type { AiConfig, AiExplainResult, FileStructure, DepGraphResult } from '../shared/types.ts'

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

/** 判断该语言能否解释:目前只有 AST 分析支持的语言才能给模型喂结构 */
export function isExplainable(languageId: string): boolean {
  return /^(typescript|typescript-react|javascript|javascript-react|python)$/.test(languageId)
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

/**
 * 调 LM Studio 的 OpenAI 兼容接口,拿到人话解释。
 * 能力边界:结构太稀疏或服务不通时,返回对应的 status,不影响界面。
 */
export async function explainWithModel(config: AiConfig, prompt: string): Promise<AiExplainResult> {
  const startedAt = Date.now()
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000) // 本地大模型慢,给足 2 分钟
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 500
      }),
      signal: controller.signal
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return {
        status: 'error',
        text: `模型服务返回错误(${res.status})${detail ? `:${detail.slice(0, 120)}` : ''}`,
        model: config.model,
        durationMs: Date.now() - startedAt
      }
    }

    const data = (await res.json()) as ChatCompletionResponse
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) {
      return { status: 'error', text: '模型没有返回内容,可能没加载成功', model: config.model, durationMs: Date.now() - startedAt }
    }
    return { status: 'supported', text: content, model: config.model, durationMs: Date.now() - startedAt }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    const msg = isAbort
      ? '模型响应超时,可能模型还在加载,或太大跑不动'
      : `连不上模型服务,检查 LM Studio 是否已启动(默认 ${baseUrl})`
    return { status: 'error', text: msg, model: config.model, durationMs: Date.now() - startedAt }
  }
}
