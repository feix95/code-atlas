// 侧栏说明区块与图谱 AI 名称的数据源:按当前项目、当前语种读整份页快照。
// 生成中每落盘一篇就重读;改语种后跟着换;读盘失败保留上一份,不把已有说明清空。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DepGraphResult, ScanResult } from '@shared/types'
import type { WikiEvent, WikiPageSource, WikiPanelPage } from '@shared/wikiTypes'
import { friendlyErr } from './errText'
import { onWikiLanguageChanged } from './wikiLanguageBus'
import { assembleWikiPages } from './wikiProgressModel'

export interface WikiPanelData {
  language: string
  /** 记账损坏:区块不装数据,由侧栏提示重建 */
  damaged: boolean
  /** 当前图谱切出的全部页:搜索的名称、路径与成员来源 */
  sources: readonly WikiPageSource[]
  pages: ReadonlyMap<string, WikiPanelPage>
  /** 文件 → 所属页 id;模块成员、附挂与散件组成员都收 */
  filePage: ReadonlyMap<string, string>
  /** 页 id → 程序名(模块程序名 / 散件组名) */
  programName: ReadonlyMap<string, string>
  error: string | null
  /** 在系统文件管理器中定位这篇 Markdown */
  revealDoc: (file: string) => void
}

interface PageIndex {
  filePage: Map<string, string>
  programName: Map<string, string>
}

function pageIndex(pages: readonly WikiPageSource[]): PageIndex {
  const filePage = new Map<string, string>()
  const programName = new Map<string, string>()
  for (const page of pages) {
    programName.set(page.pageId, page.name)
    const files = [...page.files.map((file) => file.path), ...page.attachedFiles]
    for (const file of files) if (!filePage.has(file)) filePage.set(file, page.pageId)
  }
  return { filePage, programName }
}

function emptyData(
  index: PageIndex,
  sources: readonly WikiPageSource[],
  error: string | null
): WikiPanelData {
  return {
    language: '',
    damaged: false,
    sources,
    pages: new Map(),
    ...index,
    error,
    revealDoc: () => undefined
  }
}

export function useWikiPanel(
  result: ScanResult | null,
  graph: DepGraphResult | null
): WikiPanelData | null {
  const pages = useMemo(() => assembleWikiPages(result, graph), [result, graph])
  const root = result?.rootPath ?? null
  const [data, setData] = useState<WikiPanelData | null>(null)
  const seq = useRef(0)
  const revealTarget = useRef<{ root: string; language: string } | null>(null)

  const revealDoc = useCallback((file: string) => {
    const target = revealTarget.current
    if (target === null) return
    void window.atlas.wiki.revealDoc(target.root, target.language, file).then((outcome) => {
      if (!outcome.ok) {
        setData((prev) => (prev === null ? prev : { ...prev, error: outcome.message }))
      }
    })
  }, [])

  const read = useCallback(async (): Promise<WikiPanelData | null> => {
    if (root === null || pages.length === 0) return null
    const index = pageIndex(pages)
    try {
      const settings = await window.atlas.wiki.settingsGet()
      const base: WikiPanelData = {
        language: settings.language,
        damaged: false,
        sources: pages,
        pages: new Map(),
        ...index,
        error: null,
        revealDoc
      }
      revealTarget.current = { root, language: settings.language }
      if (settings.location === null) return base
      const state = await window.atlas.wiki.panelState({
        projectRoot: root,
        language: settings.language,
        pages
      })
      if (!state.ok) return { ...base, error: state.error }
      return {
        ...base,
        language: state.language,
        damaged: state.damaged,
        pages: new Map(state.pages.map((page) => [page.pageId, page]))
      }
    } catch (err) {
      return emptyData(index, pages, friendlyErr(err))
    }
  }, [root, pages, revealDoc])

  const reload = useCallback((): void => {
    const id = ++seq.current
    void read().then((next) => {
      if (id === seq.current) setData(next)
    })
  }, [read])

  const reloadRef = useRef(reload)
  useEffect(() => {
    reloadRef.current = reload
  })

  useEffect(() => {
    if (root === null || pages.length === 0) return
    reloadRef.current()
  }, [root, pages])

  useEffect(() => {
    if (root === null) return
    const offEvent = window.atlas.wiki.onEvent((event: WikiEvent) => {
      if (event.projectRoot !== root) return
      if (event.type === 'finished' || event.page.status === 'done') reloadRef.current()
    })
    const offLanguage = onWikiLanguageChanged(() => reloadRef.current())
    return () => {
      offEvent()
      offLanguage()
    }
  }, [root])

  return data
}
