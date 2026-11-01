// 设置页「仓库 Wiki 存储」的数据源:设置、根目录占用与四个动作。
// 动作都走主进程的二次校验,这里只把结果落成界面状态。
import { useCallback, useEffect, useState } from 'react'
import { formatSize } from '@shared/fsMessages'
import type { WikiRootScan, WikiSettings } from '@shared/wikiTypes'
import { friendlyErr } from './errText'
import { recentProjectPaths } from './recents'
import { notifyWikiLanguageChanged } from './wikiLanguageBus'

export interface WikiStorageApi {
  loading: boolean
  busy: boolean
  settings: WikiSettings | null
  scan: WikiRootScan | null
  error: string | null
  notice: string | null
  dismissNotice: () => void
  chooseLocation: () => Promise<void>
  openLocation: () => Promise<void>
  setLanguage: (code: string) => Promise<void>
  cleanupAll: () => Promise<void>
}

interface StorageRead {
  settings: WikiSettings
  scan: WikiRootScan
}

export function useWikiStorage(): WikiStorageApi {
  const [settings, setSettings] = useState<WikiSettings | null>(null)
  const [scan, setScan] = useState<WikiRootScan | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const read = useCallback(async (): Promise<StorageRead> => {
    const nextSettings = await window.atlas.wiki.settingsGet()
    const nextScan = await window.atlas.wiki.scanRoot()
    return { settings: nextSettings, scan: nextScan }
  }, [])

  const apply = useCallback((result: StorageRead): void => {
    setSettings(result.settings)
    setScan(result.scan)
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

  const chooseLocation = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const choice = await window.atlas.wiki.chooseLocation([...new Set(recentProjectPaths())])
      if (!choice.ok) {
        if (!choice.cancelled) setError(choice.error)
        return
      }
      setNotice(
        choice.usedSubdirectory
          ? `这个文件夹里已有别的内容,实际写入 ${choice.location}`
          : `存放位置已改为 ${choice.location}`
      )
      apply(await read())
    } catch (err) {
      setError(friendlyErr(err))
    } finally {
      setBusy(false)
    }
  }, [read, apply])

  const openLocation = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const result = await window.atlas.wiki.openLocation()
      if (!result.ok) setError(result.message)
    } catch (err) {
      setError(friendlyErr(err))
    }
  }, [])

  const setLanguage = useCallback(async (code: string): Promise<void> => {
    setError(null)
    try {
      const result = await window.atlas.wiki.saveLanguage(code)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setSettings((prev) => (prev === null ? prev : { ...prev, language: code }))
      notifyWikiLanguageChanged()
    } catch (err) {
      setError(friendlyErr(err))
    }
  }, [])

  const cleanupAll = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const outcome = await window.atlas.wiki.cleanupAll()
      if (!outcome.ok) {
        setError(
          outcome.damaged.length > 0
            ? `${outcome.reason};记账损坏的目录:${outcome.damaged.join('、')}`
            : outcome.reason
        )
        return
      }
      setNotice(
        `已清理 ${outcome.projects} 个项目 · ${outcome.files} 篇文档,腾出 ${formatSize(outcome.bytes)}`
      )
      apply(await read())
    } catch (err) {
      setError(friendlyErr(err))
    } finally {
      setBusy(false)
    }
  }, [read, apply])

  return {
    loading,
    busy,
    settings,
    scan,
    error,
    notice,
    dismissNotice: () => setNotice(null),
    chooseLocation,
    openLocation,
    setLanguage,
    cleanupAll
  }
}
