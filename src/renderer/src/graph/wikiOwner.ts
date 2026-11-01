// 文件对应的 Wiki 页与所属散件组:模块文件没有组名,散件组还没生成也先给出归属。
import type { WikiPanelPage } from '@shared/wikiTypes'
import type { WikiPanelData } from '../useWikiPanel'

export interface WikiOwner {
  page: WikiPanelPage | null
  groupName: string | null
}

export function wikiOwnerOf(wiki: WikiPanelData | null, file: string): WikiOwner {
  const pageId = wiki?.filePage.get(file)
  if (pageId === undefined) return { page: null, groupName: null }
  const page = wiki?.pages.get(pageId) ?? null
  // 还没生成时用程序名兜底,至少能说出这文件归哪一组
  const groupName = pageId.startsWith('g:')
    ? page?.name || wiki?.programName.get(pageId) || null
    : null
  return { page, groupName }
}
