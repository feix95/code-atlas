// Wiki 进度页的数据源:设置 + 记账快照 + 本轮实时事件。
// 生成任务在主进程跑,界面只订阅事件并在收场后重新读盘 —— 重启过的页面靠记账照样能摆出来。
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  WikiEvent,
  WikiLanguageSummary,
  WikiLocationChoice,
  WikiPageProgress,
  WikiPageSource,
  WikiSettings
} from '@shared/wikiTypes'
import { friendlyErr } from './errText'
import { recentProjectPaths } from './recents'
import { wikiEventKey } from './wikiProgressModel'

export interface WikiSnapshot {
  projectDir: string
  damaged: boolean
  languages: WikiLanguageSummary[]
}

export interface WikiRunState {
  language: string
  total: number
  processed: number
  provider: string
  model: string
}

export type WikiFinish = Extract<WikiEvent, { type: 'finished' }>

interface WikiReadResult {
  settings: WikiSettings | null
  snapshot: WikiSnapshot | null
  error: string | null
  /** 挂载时已经有任务在跑:补读快照,不用等下一页事件 */
  run: WikiRunState | null
}

export interface WikiProgressApi {
  loading: boolean
  settings: WikiSettings | null
  snapshot: WikiSnapshot | null
  loadError: string | null
  /** 键 = 语种 + 页 id,同一项目换语种生成时两边的进度互不串 */
  events: Record<string, WikiPageProgress>
  run: WikiRunState | null
  finish: WikiFinish | null
  actionError: string | null
  dismissActionError: () => void
  reload: () => Promise<void>
  cancel: () => Promise<void>
  /** 按给定页清单发起一轮生成;only 为 null 表示全量(按缓存键跳过已是最新的页) */
  runPages: (
    pages: WikiPageSource[],
    language: string,
    only: string[] | null,
    force?: boolean
  ) => Promise<void>
  openDoc: (language: string, file: string) => Promise<void>
  revealDoc: (language: string, file: string) => Promise<void>
  chooseLocation: () => Promise<void>
  openLocation: () => Promise<void>
}

export function useWikiProgress(projectRoot: string | null): WikiProgressApi {
  const [settings, setSettings] = useState<WikiSettings | null>(null)
  const [snapshot, setSnapshot] = useState<WikiSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [events, setEvents] = useState<Record<string, WikiPageProgress>>({})
  const [run, setRun] = useState<WikiRunState | null>(null)
  const [finish, setFinish] = useState<WikiFinish | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const read = useCallback(async (): Promise<WikiReadResult> => {
    if (projectRoot === null) return { settings: null, snapshot: null, error: null, run: null }
    try {
      const nextSettings = await window.atlas.wiki.settingsGet()
      const status = await window.atlas.wiki.runStatus()
      const run =
        status.active && status.projectRoot === projectRoot
          ? {
              language: status.language,
              total: status.total,
              processed: status.processed,
              provider: status.provider,
              model: status.model
            }
          : null
      if (nextSettings.location === null) {
        return { settings: nextSettings, snapshot: null, error: null, run }
      }
      const state = await window.atlas.wiki.projectState(projectRoot)
      if (!state.ok) return { settings: nextSettings, snapshot: null, error: state.error, run }
      return {
        settings: nextSettings,
        snapshot: {
          projectDir: state.projectDir,
          damaged: state.damaged,
          languages: state.languages
        },
        error: null,
        run
      }
    } catch (err) {
      return { settings: null, snapshot: null, error: friendlyErr(err), run: null }
    }
  }, [projectRoot])

  const applyRead = useCallback((result: WikiReadResult): void => {
    if (result.settings !== null) setSettings(result.settings)
    if (result.run !== null) setRun(result.run)
    setSnapshot(result.snapshot)
    setLoadError(result.error)
    setLoading(false)
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    applyRead(await read())
  }, [read, applyRead])

  const reloadRef = useRef(reload)
  useEffect(() => {
    reloadRef.current = reload
  })

  // 进度页按项目根 key 挂载,换项目整页重来,这里只负责首次读盘
  useEffect(() => {
    void read().then(applyRead)
  }, [read, applyRead])

  useEffect(() => {
    if (projectRoot === null) return
    const off = window.atlas.wiki.onEvent((event) => {
      if (event.projectRoot !== projectRoot) return
      if (event.type === 'progress') {
        setRun((prev) =>
          prev !== null && prev.language === event.language
            ? {
                ...prev,
                total: event.total,
                processed: Math.max(prev.processed, event.processed)
              }
            : {
                language: event.language,
                total: event.total,
                processed: event.processed,
                provider: '',
                model: ''
              }
        )
        setEvents((prev) => ({
          ...prev,
          [wikiEventKey(event.language, event.page.pageId)]: event.page
        }))
        return
      }
      setFinish(event)
      setRun(null)
      void reloadRef.current()
    })
    return off
  }, [projectRoot])

  const runPages = useCallback(
    async (
      pages: WikiPageSource[],
      language: string,
      only: string[] | null,
      force = false
    ): Promise<void> => {
      if (projectRoot === null) return
      setActionError(null)
      setFinish(null)
      setEvents({})
      try {
        const result = await window.atlas.wiki.start({
          requestId: crypto.randomUUID(),
          projectRoot,
          language,
          pages,
          ...(only === null ? {} : { only }),
          ...(force ? { force: true } : {})
        })
        if (!result.ok) {
          setActionError(result.error)
          return
        }
        setRun({
          language,
          total: result.total,
          processed: 0,
          provider: result.provider,
          model: result.model
        })
      } catch (err) {
        setActionError(friendlyErr(err))
      }
    },
    [projectRoot]
  )

  const cancel = useCallback(async (): Promise<void> => {
    try {
      await window.atlas.wiki.cancel()
    } catch (err) {
      setActionError(friendlyErr(err))
    }
  }, [])

  const openDoc = useCallback(
    async (language: string, file: string): Promise<void> => {
      if (projectRoot === null) return
      const result = await window.atlas.wiki.openDoc(projectRoot, language, file)
      if (!result.ok) setActionError(result.message)
    },
    [projectRoot]
  )

  const revealDoc = useCallback(
    async (language: string, file: string): Promise<void> => {
      if (projectRoot === null) return
      const result = await window.atlas.wiki.revealDoc(projectRoot, language, file)
      if (!result.ok) setActionError(result.message)
    },
    [projectRoot]
  )

  const chooseLocation = useCallback(async (): Promise<void> => {
    try {
      const roots =
        projectRoot === null ? recentProjectPaths() : [projectRoot, ...recentProjectPaths()]
      const choice: WikiLocationChoice = await window.atlas.wiki.chooseLocation([...new Set(roots)])
      if (choice.ok) {
        await reloadRef.current()
        return
      }
      if (!choice.cancelled) setActionError(choice.error)
    } catch (err) {
      setActionError(friendlyErr(err))
    }
  }, [projectRoot])

  const openLocation = useCallback(async (): Promise<void> => {
    try {
      const result = await window.atlas.wiki.openLocation()
      if (!result.ok) setActionError(result.message)
    } catch (err) {
      setActionError(friendlyErr(err))
    }
  }, [])

  return {
    loading,
    settings,
    snapshot,
    loadError,
    events,
    run,
    finish,
    actionError,
    dismissActionError: () => setActionError(null),
    reload,
    cancel,
    runPages,
    openDoc,
    revealDoc,
    chooseLocation,
    openLocation
  }
}
