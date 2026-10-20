/**
 * 自由对话的文件附件(对齐 Claude Code 的 @文件 路线):类型、上限、按行截断、
 * 动态预算、主进程收编洗白。
 * 全是纯函数 —— 渲染层与主进程共用同一把尺子,自测一把全摁住。
 * 路线概要:文件拖/选进来 = 内容进这一轮消息(当资料,不是指令);装不下按行截断,
 * 行账(第 1-N 行 / 共 M 行)明写在提示词里;翻文件开着时探针可带 offset 自己续读。
 * 系统拖/选进来的另带本机绝对路径(absPath),主进程凭它发本次运行的只读授权令牌
 * (拖入即授权),截断的长文件就有续读的钥匙;文件树拖来的走 relPath,不占授权令牌。
 */

/** 一轮最多带几个文件(和图片同一个口径):小模型上下文有限,一份文件就占不少座 */
export const CHAT_FILES_MAX = 3

/** 单份文件的静态上限(单位:字符):渲染层先按它裁到行边界,主进程也守这条线 */
export const CHAT_FILE_CHARS_MAX = 20000

/** 一轮里所有文件的动态预算:设下限与上限(和引用账同一口径) */
export const FILE_TOTAL_CHARS_MIN = 6000
export const FILE_TOTAL_CHARS_MAX = 20000

/** absPath 字段(拖入即授权的凭据)的长度护栏:只做形状约束,真正的授权在翻文件沙盒口二道拦 */
export const ABS_PATH_MAX_CHARS = 1024

/** 一份已收编的文件附件:id 给界面认账;text 是裁过行边界的正文 */
export interface ChatFileAttachment {
  id: string
  name: string
  /** 项目内相对路径(文件树拖进来的才有);系统拖进来的没有,探针也就没法顺着它续读 */
  relPath?: string
  /** 系统拖/选进来的文件在本机的绝对路径(拖入即授权的凭据);文件树拖来的没有 */
  absPath?: string
  /** 文件正文(已按 CHAT_FILE_CHARS_MAX 裁到行边界) */
  text: string
  /** 文件真实总行数(整份的账,不因裁剪变小) */
  totalLines: number
  /** 文件字节数(收编/去重用;拿不到就是 0) */
  size: number
}

/** 裁剪结果:正文 + 实际带到第几行 + 这次裁有没有动过内容 */
export interface FileTextClip {
  text: string
  shownEndLine: number
  truncated: boolean
}

/** 数行:末尾的换行符造出来的空尾巴不算一行(和预览同口径) */
function countLines(text: string): number {
  const lines = text.split('\n')
  return lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}

/**
 * 按行边界裁正文(纯函数,自测覆盖):尽量整行收,收不下就停在行边界;
 * 第一行自己就超线(压缩成一行的怪文件)才把它裁断,尾巴标省略号。
 * 只差一个末尾换行符的"裁"不算裁 —— 内容没丢就照原样返回。
 */
export function clipTextToLines(text: string, maxChars: number): FileTextClip {
  const cap = Math.max(1, Math.floor(maxChars) || 1)
  const total = countLines(text)
  if (text.length <= cap) return { text, shownEndLine: total, truncated: false }
  const lines = text.split('\n')
  const lineCount =
    lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  let used = 0
  let kept = 0
  for (let i = 0; i < lineCount; i += 1) {
    const cost = kept === 0 ? lines[i].length : lines[i].length + 1
    if (used + cost > cap) break
    used += cost
    kept += 1
  }
  if (kept >= lineCount) return { text, shownEndLine: total, truncated: false }
  if (kept === 0) {
    const head = lines[0].slice(0, Math.max(1, cap - 1))
    return { text: `${head}…`, shownEndLine: 1, truncated: true }
  }
  return { text: lines.slice(0, kept).join('\n'), shownEndLine: kept, truncated: true }
}

/** 每份文件分到的配额与裁好后的正文 */
export interface FileBudgetItem {
  text: string
  shownEndLine: number
  truncated: boolean
}

/**
 * 文件预算规划(纯函数,自测覆盖):一轮带的所有文件共享一个动态总额度 ——
 * 可用配额折成字符(保守口径:一个字算一个 token),设下限(6000)、设上限(20000)。
 * 分座按「剩余配额 / 剩余人数」走:小文件省下的配额顺延给后面的大文件;
 * 单份文件另受静态上限(20000)约束。截断只裁到行边界,绝不静默丢内容(注记由装配层写)。
 */
export function planFileAttachments(input: {
  ctxTokens: number
  replyTokens: number
  /** 已排定的固定开销(人设+资料+问题+联网+图片),文件不许占用其配额 */
  otherTokens: number
  files: Array<{ text: string; totalLines: number }>
}): FileBudgetItem[] {
  if (input.files.length === 0) return []
  const free = input.ctxTokens - input.otherTokens - input.replyTokens
  const total = Math.min(FILE_TOTAL_CHARS_MAX, Math.max(FILE_TOTAL_CHARS_MIN, Math.floor(free)))
  const items: FileBudgetItem[] = []
  let remaining = total
  for (let i = 0; i < input.files.length; i += 1) {
    const share = Math.max(1, Math.floor(remaining / (input.files.length - i)))
    const clip = clipTextToLines(input.files[i].text, Math.min(share, CHAT_FILE_CHARS_MAX))
    items.push({
      text: clip.text,
      shownEndLine: clip.shownEndLine,
      // 行账说话:「带到的行数 < 文件总行数」就是没带全(渲染层先裁过的也算)
      truncated: clip.truncated || clip.shownEndLine < input.files[i].totalLines
    })
    remaining = Math.max(0, remaining - clip.text.length)
  }
  return items
}

/** 附件实际带到的行数(按裁过的正文数,给界面做行账标签) */
export function fileAttachShownLines(attachment: { text: string }): number {
  return countLines(attachment.text)
}

/** 给界面看的行账:第 1-N 行 / 共 M 行;整份带全了就只写 共 M 行 */
export function fileAttachRangeLabel(f: ChatFileAttachment): string {
  const shown = fileAttachShownLines(f)
  if (shown < f.totalLines) return `第 1-${shown} 行 / 共 ${f.totalLines} 行`
  return `共 ${f.totalLines} 行`
}

// ── 主进程收编:渲染层递来的文件再过一遍筛,脏数据不许混进发给模型的消息 ──

export interface SanitizedChatFiles {
  files: ChatFileAttachment[]
  /** 没收进来的文件各自的理由(给人看的,调用方用来报错/垫灰字) */
  rejected: string[]
}

/**
 * 渲染层递来的文件列表洗成可发形状(纯函数,自测覆盖):
 * 数量封顶;name/text/totalLines 形状不对的整条丢,理由留在 rejected 里;
 * relPath 只做形状约束(明显的越界样式丢掉这个字段,文件本身照收)——
 * 真正的越界由翻文件沙盒的 joinRoot 二道拦,这里不是安全边界。
 * 正文超静态上限的裁掉(渲染层本该先裁,这里是防御性二道)。
 */
export function sanitizeChatFiles(raw: unknown): SanitizedChatFiles {
  const files: ChatFileAttachment[] = []
  const rejected: string[] = []
  if (!Array.isArray(raw)) return { files, rejected }
  for (const item of raw) {
    if (files.length >= CHAT_FILES_MAX) {
      rejected.push(`一次最多带 ${CHAT_FILES_MAX} 个文件,超出的没带进来`)
      break
    }
    if (typeof item !== 'object' || item === null) {
      rejected.push('有条文件数据是坏的,没带进来')
      continue
    }
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' && o.name.trim() !== '' ? o.name.trim() : '文件'
    const fail = (why: string): void => {
      rejected.push(`「${name}」${why}`)
    }
    const text = typeof o.text === 'string' ? o.text : ''
    if (text.trim() === '') {
      fail('内容是空的,没带进来')
      continue
    }
    const totalLines = typeof o.totalLines === 'number' ? Math.trunc(o.totalLines) : Number.NaN
    if (!Number.isFinite(totalLines) || totalLines < 1) {
      fail('行数对不上,没带进来')
      continue
    }
    const relPathRaw = typeof o.relPath === 'string' ? o.relPath.trim() : ''
    const relPath =
      relPathRaw !== '' &&
      relPathRaw.length <= 400 &&
      !relPathRaw.includes('..') &&
      !relPathRaw.startsWith('/') &&
      !/^[a-zA-Z]:/.test(relPathRaw)
        ? relPathRaw
        : undefined
    // 绝对路径只做形状约束(盘符/UNC/斜杠开头);真正的授权在翻文件沙盒口
    // (realpath + 必须是单个文件)二道拦 —— 和 relPath 同一条口径,这里不是安全边界
    const absPathRaw = typeof o.absPath === 'string' ? o.absPath.trim() : ''
    const absPath =
      absPathRaw !== '' &&
      absPathRaw.length <= ABS_PATH_MAX_CHARS &&
      !absPathRaw.includes('\0') &&
      (/^[a-zA-Z]:[\\/]/.test(absPathRaw) ||
        absPathRaw.startsWith('\\\\') ||
        absPathRaw.startsWith('/'))
        ? absPathRaw
        : undefined
    const size =
      typeof o.size === 'number' && Number.isFinite(o.size) && o.size >= 0 ? Math.floor(o.size) : 0
    files.push({
      id: typeof o.id === 'string' && o.id !== '' ? o.id : crypto.randomUUID(),
      name,
      relPath,
      absPath,
      text: text.length > CHAT_FILE_CHARS_MAX ? text.slice(0, CHAT_FILE_CHARS_MAX) : text,
      totalLines,
      size
    })
  }
  return { files, rejected }
}
