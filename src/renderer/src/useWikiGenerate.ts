// 生成确认弹窗的数据源:模型来源、语种、存放位置与本项目的记账对账。
// 弹窗只在打开时挂载,关掉即清场;真正的生成由主进程任务接管。
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ModelStatus } from '@shared/types'
import type {
  WikiLanguageSummary,
  WikiPageSource,
  WikiProjectStateResult,
  WikiSettings
} from '@shared/wikiTypes'
import { DEFAULT_WIKI_LANGUAGE } from '@shared/wikiTypes'
import { friendlyErr } from './errText'
import { recentProjectPaths } from './recents'
import { notifyWikiLanguageChanged } from './wikiLanguageBus'
import { mergeWikiRows, planWikiRows, type WikiRunPlan } from './wikiProgressModel'

export interface WikiGenerateApi {
  loading: boolean
  busy: boolean
  error: string | null
  notice: string | null
  settings: WikiSettings | null
  model: ModelStatus | null
  cloudBlocked: boolean
  damaged: boolean
  language: string
  summary: WikiLanguageSummary | null
  plan: WikiRunPlan
  canStart: boolean
  dismissNotice: () => void
  chooseLocation: () => Promise<void>
  setLanguage: (code: string) => Promise<void>
  start: () => Promise<boolean>
}

interface GenerateRead {
  settings: WikiSettings
  model: ModelStatus
  consented: boolean
  project: WikiProjectStateResult | null
}

export function useWikiGenerate(
  projectRoot: string,
  pages: readonly WikiPageSource[]
): WikiGenerateApi {
  const [settings, setSettings] = useState<WikiSettings | null>(null)
  const [model, setModel] = useState<ModelStatus | null>(null)
  const [consented, setConsented] = useState(false)
  const [languages, setLanguages] = useState<WikiLanguageSummary[] | null>(null)
  const [damaged, setDamaged] = useState(false)
  const [language, setLanguageState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const read = useCallback(async (): Promise<GenerateRead> => {
    const nextSettings = await window.atlas.wiki.settingsGet()
    const nextModel = await window.atlas.modelStatusGet()
    const config = await window.atlas.aiConfigGet()
    const project =
      nextSettings.location === null ? null : await window.atlas.wiki.projectState(projectRoot)
    return { settings: nextSettings, model: nextModel, consented: config.cloud.consented, project }
  }, [projectRoot])

  const apply = useCallback((result: GenerateRead): void => {
    setError(null)
    setSettings(result.settings)
    setModel(result.model)
    setConsented(result.consented)
    if (result.project === null) {
      setLanguages(null)
      setDamaged(false)
    } else if (result.project.ok) {
      setLanguages(result.project.languages)
      setDamaged(result.project.damaged)
    } else {
      setLanguages(null)
      setDamaged(false)
      setError(result.project.error)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void read()
      .then(apply)
      .catch((err: unknown) => {
        setError(friendlyErr(err))
        setLoading(false)
      })
  }, [read, apply])

  const effectiveLanguage = language ?? settings?.language ?? DEFAULT_WIKI_LANGUAGE
  const summary = useMemo(
    () => languages?.find((item) => item.code === effectiveLanguage) ?? null,
    [languages, effectiveLanguage]
  )
  const plan = useMemo(() => planWikiRows(mergeWikiRows(pages, summary, {})), [pages, summary])
  const cloudBlocked = model?.provider === 'cloud' && !consented
  const canStart =
    !loading &&
    !busy &&
    !damaged &&
    pages.length > 0 &&
    settings?.location != null &&
    model !== null &&
    model.modelName.trim() !== '' &&
    !cloudBlocked

  const chooseLocation = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const roots = [...new Set([projectRoot, ...recentProjectPaths()])]
      const choice = await window.atlas.wiki.chooseLocation(roots)
      if (!choice.ok) {
        if (!choice.cancelled) setError(choice.error)
        return
      }
      setNotice(
        choice.usedSubdirectory
          ? `这个文件夹里已有别的内容,实际写入 ${choice.location}`
          : `存放位置:${choice.location}`
      )
      apply(await read())
    } catch (err) {
      setError(friendlyErr(err))
    } finally {
      setBusy(false)
    }
  }, [projectRoot, read, apply])

  const setLanguage = useCallback(async (code: string): Promise<void> => {
    setLanguageState(code)
    setError(null)
    try {
      const result = await window.atlas.wiki.saveLanguage(code)
      if (!result.ok) setError(result.message)
      else notifyWikiLanguageChanged()
    } catch (err) {
      setError(friendlyErr(err))
    }
  }, [])

  const start = useCallback(async (): Promise<boolean> => {
    if (!canStart) return false
    setBusy(true)
    setError(null)
    try {
      const result = await window.atlas.wiki.start({
        requestId: crypto.randomUUID(),
        projectRoot,
        language: effectiveLanguage,
        pages: [...pages]
      })
      if (!result.ok) {
        setError(result.error)
        return false
      }
      return true
    } catch (err) {
      setError(friendlyErr(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [canStart, projectRoot, effectiveLanguage, pages])

  return {
    loading,
    busy,
    error,
    notice,
    settings,
    model,
    cloudBlocked,
    damaged,
    language: effectiveLanguage,
    summary,
    plan,
    canStart,
    dismissNotice: () => setNotice(null),
    chooseLocation,
    setLanguage,
    start
  }
}
