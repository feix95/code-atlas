// 单篇 Wiki 的缓存键:提示词版本 + 语种 + 成员清单 + 每份成员内容哈希 + 附挂文件 + 散件组成员。
// 模型名故意不进键:换模型不重写已完成文档,只有内容或语种变了才重生成。
import { createHash } from 'node:crypto'

/** 提示词口径变化时加一,旧文档据此整体过期 */
export const WIKI_PROMPT_VERSION = 4

export interface WikiHashInput {
  /** 语种代号,取 translateLangs */
  language: string
  /** 本篇成员 relPath;顺序无所谓,函数内部排序 */
  members: readonly string[]
  /** relPath → 内容哈希;没分析到的文件给 null,它从不可分析变可分析时同样要重写 */
  contentHashes: ReadonlyMap<string, string | null>
  /** 附挂文件(样式、自测)relPath */
  attached?: readonly string[]
  /** 散件组成员 relPath */
  groupMembers?: readonly string[]
}

export function wikiInputHash(input: WikiHashInput): string {
  const members = [...input.members].sort()
  const payload = {
    promptVersion: WIKI_PROMPT_VERSION,
    language: input.language,
    members,
    contentHashes: members.map((file) => [file, input.contentHashes.get(file) ?? null]),
    attached: [...(input.attached ?? [])].sort(),
    groupMembers: [...(input.groupMembers ?? [])].sort()
  }
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
}
