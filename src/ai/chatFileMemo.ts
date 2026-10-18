// 会话级附件户口本(滑跪案这锤):原文留不起(小锅),但「本会话收过哪些文件附件、
// 带到的哪段、重读/续读走哪条路」留得起 —— 每轮组装时垫成一张 program_note,
// 「你读完了吗/接着读完它」就有据可答。
// 对齐 Claude Code 的 file-already-in-context(原文一直留在对话里),按我们的体型
// 缩水成纸条:只说事实(当时带了什么),不替模型下结论(读了没由它照实盘点)。
// 纯内存、不落盘(「不写入无意义缓存」契约),按会话编号分账,关应用即失效。
import { TAG } from '../shared/promptTags.ts'

/** 一张附件纸条:名字 + 当时的行账 + 重读/续读的路(钥匙或相对路径) */
export interface AttachedFileMemo {
  name: string
  /** 项目内相对路径(文件树拖入的才有) */
  relPath?: string
  /** 拖入即授权的续读钥匙(主进程发过牌才有) */
  rootId?: string
  /** 当时实际带到第几行(1 起) */
  shownEndLine: number
  /** 文件总行数 */
  totalLines: number
}

export interface ChatFileMemoStore {
  peek: (conversationId: string) => readonly AttachedFileMemo[]
  /** 新带的文件记账(空清单不动账:没带附件的轮不清旧纸条) */
  update: (conversationId: string, items: readonly AttachedFileMemo[]) => void
  clear: (conversationId: string) => void
}

/** 单个会话最多留几张纸条:再往回的文件基本没人追 */
export const FILE_MEMO_MAX = 3

/** 一张纸条的洗形(纯函数,自测覆盖):名字空/行账烂的整条丢;钥匙只认格式,路径只认规矩 */
export function sanitizeFileMemo(raw: unknown): AttachedFileMemo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (name === '' || name.length > 200) return null
  const totalLines = typeof o.totalLines === 'number' ? Math.trunc(o.totalLines) : Number.NaN
  if (!Number.isFinite(totalLines) || totalLines < 1) return null
  const shownRaw = typeof o.shownEndLine === 'number' ? Math.trunc(o.shownEndLine) : totalLines
  const shownEndLine = Math.min(Math.max(1, shownRaw), totalLines)
  const relPathRaw = typeof o.relPath === 'string' ? o.relPath.trim() : ''
  const relPath =
    relPathRaw !== '' &&
    relPathRaw.length <= 400 &&
    !relPathRaw.includes('..') &&
    !relPathRaw.startsWith('/') &&
    !/^[a-zA-Z]:/.test(relPathRaw)
      ? relPathRaw
      : undefined
  const rootIdRaw = typeof o.rootId === 'string' ? o.rootId.trim() : ''
  const rootId = /^external_[1-9]\d*$/.test(rootIdRaw) ? rootIdRaw : undefined
  return { name, relPath, rootId, shownEndLine, totalLines }
}

export function createChatFileMemoStore(
  limits: { sessionsMax: number; filesMax: number } = { sessionsMax: 8, filesMax: FILE_MEMO_MAX }
): ChatFileMemoStore {
  const sessions = new Map<string, AttachedFileMemo[]>()
  return {
    peek: (conversationId) => sessions.get(conversationId) ?? [],
    update: (conversationId, items) => {
      if (conversationId === '') return
      const fresh: AttachedFileMemo[] = []
      for (const item of items) {
        const clean = sanitizeFileMemo(item)
        if (clean) fresh.push(clean)
      }
      if (fresh.length === 0) return
      // 同名文件以最新一轮为准:新纸条顶掉旧同名,再按「最近在前」封顶
      const kept = (sessions.get(conversationId) ?? []).filter(
        (old) => !fresh.some((f) => f.name === old.name)
      )
      const next = [...fresh, ...kept].slice(0, limits.filesMax)
      sessions.delete(conversationId) // 删了重插 = 挪到「最近用过」的队尾
      sessions.set(conversationId, next)
      while (sessions.size > limits.sessionsMax) {
        const oldest = sessions.keys().next().value
        if (oldest === undefined) break
        sessions.delete(oldest)
      }
    },
    clear: (conversationId) => void sessions.delete(conversationId)
  }
}

/** 纸条 → 垫给模型的 program_note(纯函数,自测覆盖);没纸条回 null,不垫空话 */
export function buildFileMemoNote(memo: readonly AttachedFileMemo[]): string | null {
  if (memo.length === 0) return null
  const lines = memo.map((f, i) => {
    const full = f.shownEndLine >= f.totalLines
    const range = full
      ? `当时整份带的(全 ${f.totalLines} 行)`
      : `当时只带了第 1-${f.shownEndLine} 行 / 共 ${f.totalLines} 行`
    const reread = f.rootId
      ? full
        ? `;要重看用 read_file 带 rootId=${f.rootId}、relPath 传空字符串`
        : `;要接着读后面的部分,用 read_file 带 rootId=${f.rootId}、relPath 传空字符串、offset=${f.shownEndLine + 1}`
      : f.relPath
        ? full
          ? `;要重看直接用 read_file 读 ${f.relPath}`
          : `;要接着读后面的部分,用 read_file 读 ${f.relPath} 带 offset=${f.shownEndLine + 1}`
        : ';要重看就再拖进来一次'
    return `${i + 1}. 「${f.name}」${range}${reread}`
  })
  return [
    TAG.programNote.open,
    '本会话此前收到过的文件附件(原文当时在,现在不在本轮上下文里):',
    ...lines,
    '用户问「刚才那个文件/上一份文件」时指的就是它们;要核对内容就用工具重读,别凭记忆硬讲。',
    TAG.programNote.close
  ].join('\n')
}
