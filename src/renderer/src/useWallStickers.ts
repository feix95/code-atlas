// 线索桌便签与图片的渲染层状态:打开时从主进程读一次,改动先生效在界面上,停手 400 毫秒再整份存回。
// 切项目或关掉线索桌时把没存的改动立刻补存,不丢字。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WallSticker } from '@shared/wikiWallNotes'
import { friendlyErr } from './errText'

const SAVE_DELAY_MS = 400
const EMPTY: WallSticker[] = []

export interface WallStickersState {
  stickers: WallSticker[]
  loaded: boolean
  error: string | null
  setError: (message: string | null) => void
  update: (change: (prev: WallSticker[]) => WallSticker[]) => void
}

export function useWallStickers(rootPath: string): WallStickersState {
  // 读到的存档连同它属于哪个项目一起记:切项目后旧项目的便签不会闪现,也不放开编辑
  const [data, setData] = useState<{ root: string; stickers: WallSticker[] } | null>(null)
  const loaded = data !== null && data.root === rootPath
  const stickers = loaded ? data.stickers : EMPTY
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<{ root: string; stickers: WallSticker[] } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    const job = pending.current
    pending.current = null
    if (job === null) return
    void window.atlas.wiki
      .wallStickersSave(job.root, job.stickers)
      .then((outcome) => {
        if (!outcome.ok) setError(outcome.error)
      })
      .catch((err: unknown) => setError(`便签没存上:${friendlyErr(err)}`))
  }, [])

  useEffect(() => {
    let alive = true
    void window.atlas.wiki
      .wallStickersLoad(rootPath)
      .then((outcome) => {
        if (!alive) return
        // 读失败(比如还没选 Wiki 位置)就不放开编辑,免得空白列表盖掉旧存档
        if (outcome.ok) setData({ root: rootPath, stickers: outcome.stickers })
        else setError(outcome.error)
      })
      .catch((err: unknown) => {
        if (alive) setError(`便签读不出来:${friendlyErr(err)}`)
      })
    return () => {
      alive = false
      flush()
    }
  }, [rootPath, flush])

  const update = useCallback(
    (change: (prev: WallSticker[]) => WallSticker[]) => {
      setData((prev) => {
        if (prev === null || prev.root !== rootPath) return prev
        const next = change(prev.stickers)
        if (next === prev.stickers) return prev
        pending.current = { root: rootPath, stickers: next }
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(flush, SAVE_DELAY_MS)
        return { root: rootPath, stickers: next }
      })
    },
    [rootPath, flush]
  )

  return { stickers, loaded, error, setError, update }
}

const imageCache = new Map<string, Promise<string | null>>()

/** 图片按「项目 + 文件名」缓存成 data URL,同一张图拖来拖去不重复读盘 */
export function useWallImage(rootPath: string, file: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const key = `${rootPath}\n${file}`
    let job = imageCache.get(key)
    if (job === undefined) {
      job = window.atlas.wiki
        .wallImageRead(rootPath, file)
        .then((outcome) => (outcome.ok ? outcome.url : null))
        .catch(() => null)
      imageCache.set(key, job)
    }
    void job.then((value) => {
      if (alive) setUrl(value)
    })
    return () => {
      alive = false
    }
  }, [rootPath, file])
  return url
}
