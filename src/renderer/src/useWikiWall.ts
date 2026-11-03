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

  useEffect(() => {
    const offEvent = window.atlas.wiki.onEvent((event: WikiEvent) => {
      if (event.projectRoot !== rootPath) return
      if (event.type === 'finished') refreshRef.current()
    })
    const offLanguage = onWikiLanguageChanged(() => refreshRef.current())
    return () => {
      offEvent()
      offLanguage()
    }
  }, [rootPath])

  return { language, damaged, cards, links, loading, error, refresh }
}
