// 线索桌上用户便签与图片这一层的接线:新增(按钮、选文件、拖进来、粘贴)、拖动后重判贴哪张卡、改与删。
// 返回两块界面:layer 画在可缩放的桌面里,tools 是固定在左上角的「＋ 便签 / ＋ 图片」。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  WALL_IMAGE_MAX_BYTES,
  WALL_NOTE_H,
  WALL_NOTE_W,
  WALL_PHOTO_WIDTH,
  linkWallSticker,
  moveWallSticker,
  nextStickerZ,
  placeWallSticker,
  sortWallStickers,
  type WallSticker
} from '@shared/wikiWallNotes'
import type { WallPlacedCard } from './wikiWallLayout'
import type { WallView } from './wikiWallViewport'
import { useWallCardDrag } from './useWallCardDrag'
import { useWallStickers } from './useWallStickers'
import { WikiWallStickerView } from './components/WikiWallStickerView'
import { friendlyErr } from './errText'

interface Focus {
  id: string
  editing: boolean
}

/** 读出图片的高宽比,读不出就按 4:3 */
async function ratioOf(file: File): Promise<number> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 0.75
  } catch {
    return 0.75
  } finally {
    URL.revokeObjectURL(url)
  }
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  )
}

export function useWallStickerBoard({
  rootPath,
  cards,
  view,
  far,
  hostRef
}: {
  rootPath: string
  cards: readonly WallPlacedCard[]
  view: WallView
  /** 远景:图片不解码,画成色块 */
  far: boolean
  hostRef: React.RefObject<HTMLDivElement | null>
}): { layer: React.JSX.Element; tools: React.JSX.Element } {
  const state = useWallStickers(rootPath)
  const { update, setError } = state
  const [focus, setFocus] = useState<Focus | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const rects = useMemo(
    () =>
      cards.map((c) => ({
        pageId: c.card.pageId,
        title: c.card.title,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h
      })),
    [cards]
  )
  const byId = useMemo(() => new Map(rects.map((r) => [r.pageId, r])), [rects])
  const drag = useWallCardDrag(view.z, (id, x, y) =>
    update((prev) => moveWallSticker(prev, id, x, y, rects))
  )

  const toBoard = useCallback(
    (clientX: number, clientY: number) => {
      const box = hostRef.current?.getBoundingClientRect()
      if (box === undefined) return { x: 0, y: 0 }
      return {
        x: Math.round((clientX - box.left - view.x) / view.z),
        y: Math.round((clientY - box.top - view.y) / view.z)
      }
    },
    [hostRef, view]
  )
  const center = useCallback(() => {
    const box = hostRef.current?.getBoundingClientRect()
    return box === undefined
      ? { x: 0, y: 0 }
      : toBoard(box.left + box.width / 2, box.top + box.height / 2)
  }, [hostRef, toBoard])

  const patch = useCallback(
    (id: string, change: (s: WallSticker) => WallSticker) =>
      update((prev) => prev.map((s) => (s.id === id ? change(s) : s))),
    [update]
  )
  const remove = useCallback(
    (id: string) => {
      update((prev) => prev.filter((s) => s.id !== id))
      setFocus(null)
    },
    [update]
  )

  const addNote = (): void => {
    const at = center()
    const id = crypto.randomUUID()
    const x = at.x - WALL_NOTE_W / 2
    const y = at.y - WALL_NOTE_H / 2
    update((prev) => [
      ...prev,
      { id, kind: 'note', color: 'yellow', text: '', x, y, z: nextStickerZ(prev), attach: null }
    ])
    setFocus({ id, editing: true })
  }

  const addImages = useCallback(
    async (files: readonly File[], at: { x: number; y: number }) => {
      const images = files.filter((f) => f.type.startsWith('image/'))
      if (images.length === 0) return
      let offset = 0
      for (const file of images) {
        if (file.size > WALL_IMAGE_MAX_BYTES) {
          setError(`「${file.name}」超过 10MB,换一张小点的`)
          continue
        }
        try {
          const [saved, ratio] = await Promise.all([
            window.atlas.wiki.wallImageSave(rootPath, new Uint8Array(await file.arrayBuffer())),
            ratioOf(file)
          ])
          if (!saved.ok) {
            setError(saved.error)
            continue
          }
          const id = crypto.randomUUID()
          const x = at.x - WALL_PHOTO_WIDTH.m / 2 + offset
          const y = at.y - 80 + offset
          offset += 24
          update((prev) => [
            ...prev,
            {
              id,
              kind: 'photo',
              file: saved.file,
              caption: '',
              size: 'm',
              ratio,
              x,
              y,
              z: nextStickerZ(prev),
              attach: null
            }
          ])
          setFocus({ id, editing: false })
        } catch (err) {
          setError(`图片没存上:${friendlyErr(err)}`)
        }
      }
    },
    [rootPath, update, setError]
  )

  // 拖文件进桌面:落在松手的位置;粘贴:落在视野中间。没读到存档前不收,免得盖掉旧存档
  useEffect(() => {
    const host = hostRef.current
    if (host === null || !state.loaded) return
    const over = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const drop = (event: DragEvent): void => {
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length === 0) return
      event.preventDefault()
      void addImages(files, toBoard(event.clientX, event.clientY))
    }
    const paste = (event: ClipboardEvent): void => {
      if (isTyping(event.target)) return
      const files = [...(event.clipboardData?.files ?? [])]
      if (files.length === 0) return
      event.preventDefault()
      void addImages(files, center())
    }
    host.addEventListener('dragover', over)
    host.addEventListener('drop', drop)
    window.addEventListener('paste', paste)
    return () => {
      host.removeEventListener('dragover', over)
      host.removeEventListener('drop', drop)
      window.removeEventListener('paste', paste)
    }
  }, [hostRef, state.loaded, addImages, toBoard, center])

  // 点到便签以外的地方就取消选中
  useEffect(() => {
    if (focus === null) return
    const down = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('.wiki-wall-sticker') !== null)
        return
      setFocus(null)
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [focus])

  const layer = (
    <>
      {sortWallStickers(state.stickers).map((sticker) => {
        const draft = drag.draft?.id === sticker.id ? drag.draft : null
        const placed = placeWallSticker(sticker, byId)
        const rect = draft === null ? placed : { ...placed, x: draft.x, y: draft.y }
        // 拖动途中照旧显示原来的关联,松手那一刻才重新判定
        const host = placed.attachedTo === null ? undefined : byId.get(placed.attachedTo)
        return (
          <WikiWallStickerView
            key={sticker.id}
            rootPath={rootPath}
            far={far}
            sticker={sticker}
            rect={rect}
            hostTitle={host?.title ?? null}
            selected={focus?.id === sticker.id}
            editing={focus?.id === sticker.id && focus.editing}
            dragging={draft !== null}
            onPointerDown={(event) => drag.start(event, { id: sticker.id, x: rect.x, y: rect.y })}
            onSelect={() => {
              if (!drag.consumeClick())
                setFocus((f) => (f?.id === sticker.id ? f : { id: sticker.id, editing: false }))
            }}
            onEdit={(editing) => setFocus({ id: sticker.id, editing })}
            onChange={(change) => patch(sticker.id, change)}
            onDelete={() => remove(sticker.id)}
            linkCards={rects}
            onLink={(pageId) => update((prev) => linkWallSticker(prev, sticker.id, pageId, rects))}
          />
        )
      })}
    </>
  )

  const tools = (
    <div className="wiki-wall-sticker-tools" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" disabled={!state.loaded} onClick={addNote}>
        ＋ 便签
      </button>
      <button type="button" disabled={!state.loaded} onClick={() => fileInput.current?.click()}>
        ＋ 图片
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          void addImages(files, center())
        }}
      />
      {state.error !== null && (
        <span className="wiki-wall-sticker-error" role="alert">
          {state.error}
          <button type="button" aria-label="知道了" onClick={() => setError(null)}>
            ×
          </button>
        </span>
      )}
    </div>
  )

  return { layer, tools }
}
