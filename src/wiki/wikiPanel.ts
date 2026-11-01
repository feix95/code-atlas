// 侧栏 Wiki 区块的数据装配:把记账记录、文件是否还在与当前内容哈希翻成面板状态。
// 纯函数;读盘与哈希由调用方(主进程 IPC)注入,过期判定口径与生成任务一致。
import type { WikiPanelPage, WikiPageSource } from '../shared/wikiTypes.ts'
import { WIKI_PROMPT_VERSION } from './wikiHash.ts'
import type { WikiPageRecord } from './wikiStore.ts'

export interface WikiPanelInput {
  source: WikiPageSource
  record: WikiPageRecord | undefined
  exists: boolean
  /** 当前内容哈希;环境还拿不到(分析未完成)时传 null,不判过期 */
  currentHash: string | null
}

function emptyPage(source: WikiPageSource): WikiPanelPage {
  return {
    pageId: source.pageId,
    kind: source.kind,
    status: 'none',
    name: '',
    summary: '',
    tags: [],
    keyFiles: [],
    excerpt: '',
    file: '',
    generatedAt: '',
    model: ''
  }
}

/**
 * 记账里完成的页再看文件与内容:文件不在为缺失,内容哈希或提示词版本不同为过期;
 * 文件缺失优先于过期 —— 用户先要知道文档去哪了。
 */
export function panelPageOf(input: WikiPanelInput): WikiPanelPage {
  const { source, record, exists, currentHash } = input
  if (!record) return emptyPage(source)
  let status = record.status
  if (record.status === 'done') {
    if (!exists) status = 'missing'
    else if (
      currentHash !== null &&
      (record.inputHash !== currentHash || record.promptVersion !== WIKI_PROMPT_VERSION)
    ) {
      status = 'stale'
    }
  }
  return {
    pageId: record.pageId,
    kind: record.kind,
    status,
    name: record.name,
    summary: record.summary ?? '',
    tags: record.tags ?? [],
    keyFiles: record.keyFiles ?? [],
    excerpt: record.excerpt ?? '',
    file: record.file,
    generatedAt: record.generatedAt,
    model: record.model
  }
}
