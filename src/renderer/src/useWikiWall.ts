// 卡片墙数据源:按当前项目与语种读整面墙(规划现算、状态并记账)。
// 生成结束与语种切换后重读;读失败保留上一份,不把已展示的墙清空。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WikiEvent, WikiWallCard, WikiWallLink } from '@shared/wikiTypes'
import { friendlyErr } from './errText'
import { onWikiLanguageChanged } from './wikiLanguageBus'

export interface WikiWallData {
  language: string
  damaged: boolean
  cards: WikiWallCard[]
  links: WikiWallLink[]
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useWikiWall(rootPath: string): WikiWallData {
  const [language, setLanguage] = useState('')
  const [damaged, setDamaged] = useState(false)
  const [cards, setCards] = useState<WikiWallCard[]>([])
  const [links, setLinks] = useState<WikiWallLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  const refresh = useCallback(() => {
    const seq = (seqRef.current += 1)
    setLoading(true)
    void (async () => {
      try {
        const settings = await window.atlas.wiki.settingsGet()
        const wall = await window.atlas.wiki.wallState(rootPath, settings.language)
        if (seqRef.current !== seq) return
        setLanguage(settings.language)
        if (!wall.ok) {
          setError(wall.error)
          return
        }
        setDamaged(wall.damaged)
        setCards(wall.cards)
        setLinks(wall.links)
        setError(null)
      } catch (err) {
        if (seqRef.current === seq) setError(friendlyErr(err))
      } finally {
        if (seqRef.current === seq) setLoading(false)
      }
    })()
  }, [rootPath])

  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    refreshRef.current()
  }, [rootPath])

  const lastRefreshRef = useRef(0)
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // 生成中每页落定就刷新一次卡片状态,节流 4 秒:本地模型一页十几分钟,
    // 只等整轮结束才刷新会让用户以为没在跑
    const throttledRefresh = (): void => {
      const now = Date.now()
      const wait = 4000 - (now - lastRefreshRef.current)
      if (wait <= 0) {
        lastRefreshRef.current = now
        refreshRef.current()
        return
      }
      if (pendingTimerRef.current === null) {
        pendingTimerRef.current = setTimeout(() => {
          pendingTimerRef.current = null
          lastRefreshRef.current = Date.now()
          refreshRef.current()
        }, wait)
      }
    }
    const offEvent = window.atlas.wiki.onEvent((event: WikiEvent) => {
      if (event.projectRoot !== rootPath) return
      if (event.source !== 'v2') return
      if (event.type === 'finished') {
        lastRefreshRef.current = Date.now()
        refreshRef.current()
      } else if (event.page.status !== 'running') {
        throttledRefresh()
      }
    })
    const offLanguage = onWikiLanguageChanged(() => refreshRef.current())
    return () => {
      offEvent()
      offLanguage()
      if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current)
    }
  }, [rootPath])

  return { language, damaged, cards, links, loading, error, refresh }
}
