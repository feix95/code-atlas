// 线索桌上的一张用户便签或图片:只管画和收输入,摆在哪、贴哪张卡、存档都交给上层。
// 选中时上方浮一条小工具:便签换颜色、图片换大小、删除;双击便签写字,双击图片说明改说明。
import {
  WALL_NOTE_COLORS,
  WALL_PHOTO_SIZES,
  WALL_CAPTION_MAX,
  WALL_NOTE_TEXT_MAX,
  type WallNoteColor,
  type WallPhotoSize,
  type WallRect,
  type WallSticker
} from '@shared/wikiWallNotes'
import { useWallImage } from '../useWallStickers'
import { wallSeed } from '../wikiWallSettle'
import { WikiWallStickerLink, type WallLinkCard } from './WikiWallStickerLink'

const COLOR_LABEL: Record<WallNoteColor, string> = {
  yellow: '黄色',
  pink: '粉色',
  blue: '蓝色',
  green: '绿色',
  orange: '橙色'
}
const SIZE_LABEL: Record<WallPhotoSize, string> = { s: '小', m: '中', l: '大' }

/** 和线索卡同一套歪法:按 id 定一个 ±3° 内的固定角度,至少歪 1°,免得看着是正的 */
function tiltOf(id: string): number {
  const v = (wallSeed(`${id}:r`) * 2 - 1) * 3
  const t = Math.sign(v || 1) * Math.max(1, Math.abs(v))
  return Math.round(t * 100) / 100
}

export interface WallStickerViewProps {
  rootPath: string
  sticker: WallSticker
  rect: WallRect
  hostTitle: string | null
  /** 可以手动关联的卡片 */
  linkCards: readonly WallLinkCard[]
  selected: boolean
  editing: boolean
  dragging: boolean
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  onSelect: () => void
  onEdit: (editing: boolean) => void
  onChange: (change: (sticker: WallSticker) => WallSticker) => void
  onDelete: () => void
  /** 关联到某张卡,null 是取消关联 */
  onLink: (pageId: string | null) => void
}

/** 失焦时焦点还留在这张便签里(比如点了取消关联、关联卡片)就不退出编辑 */
function blurOut(onEdit: (editing: boolean) => void) {
  return (event: React.FocusEvent<HTMLElement>): void => {
    const own = event.currentTarget.closest('.wiki-wall-sticker')
    if (own !== null && event.relatedTarget instanceof Node && own.contains(event.relatedTarget))
      return
    onEdit(false)
  }
}

/** 输入框里的按键、按下都不往外冒:不触发拖动、平移和删除快捷键 */
const stop = (event: React.SyntheticEvent): void => event.stopPropagation()

export function WikiWallStickerView(props: WallStickerViewProps): React.JSX.Element {
  const { sticker, rect, selected, editing, dragging } = props
  const kindClass =
    sticker.kind === 'note' ? `is-note is-${sticker.color}` : `is-photo is-${sticker.size}`
  return (
    <div
      className={`wiki-wall-sticker ${kindClass}${selected ? ' is-selected' : ''}${
        dragging ? ' is-dragging' : ''
      }`}
      style={
        {
          left: rect.x,
          top: rect.y,
          width: rect.w,
          minHeight: rect.h,
          '--tilt': `${tiltOf(sticker.id)}deg`
        } as React.CSSProperties
      }
      tabIndex={0}
      role="group"
      aria-label={sticker.kind === 'note' ? '便签' : '图片'}
      onPointerDown={props.onPointerDown}
      onClick={(event) => {
        event.stopPropagation()
        props.onSelect()
      }}
      onDoubleClick={() => props.onEdit(true)}
      onKeyDown={(event) => {
        if (editing) return
        if (event.key === 'Delete' || event.key === 'Backspace') props.onDelete()
        if (event.key === 'Enter') props.onEdit(true)
      }}
    >
      {selected && !dragging && <StickerBar {...props} />}
      {sticker.kind === 'note' ? <NoteBody {...props} /> : <PhotoBody {...props} />}
      <WikiWallStickerLink
        hostTitle={props.hostTitle}
        editing={editing && !dragging}
        cards={props.linkCards}
        onLink={props.onLink}
      />
    </div>
  )
}

function StickerBar({ sticker, onChange, onDelete }: WallStickerViewProps): React.JSX.Element {
  return (
    <div className="wiki-wall-sticker-bar" onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      {sticker.kind === 'note'
        ? WALL_NOTE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`wiki-wall-swatch is-${color}${sticker.color === color ? ' is-on' : ''}`}
              aria-label={COLOR_LABEL[color]}
              aria-pressed={sticker.color === color}
              onClick={() => onChange((s) => (s.kind === 'note' ? { ...s, color } : s))}
            />
          ))
        : WALL_PHOTO_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={`wiki-wall-size${sticker.size === size ? ' is-on' : ''}`}
              aria-pressed={sticker.size === size}
              onClick={() => onChange((s) => (s.kind === 'photo' ? { ...s, size } : s))}
            >
              {SIZE_LABEL[size]}
            </button>
          ))}
      <button type="button" className="wiki-wall-sticker-del" onClick={onDelete}>
        删除
      </button>
    </div>
  )
}

function NoteBody({ sticker, editing, onEdit, onChange }: WallStickerViewProps): React.JSX.Element {
  if (sticker.kind !== 'note') return <></>
  if (!editing) {
    return (
      <p className={`wiki-wall-note-text${sticker.text === '' ? ' is-empty' : ''}`}>
        {sticker.text === '' ? '双击写点什么' : sticker.text}
      </p>
    )
  }
  return (
    <textarea
      className="wiki-wall-note-input"
      autoFocus
      maxLength={WALL_NOTE_TEXT_MAX}
      value={sticker.text}
      placeholder="写点提示…"
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') onEdit(false)
      }}
      onBlur={blurOut(onEdit)}
      onChange={(event) => {
        const text = event.target.value
        onChange((s) => (s.kind === 'note' ? { ...s, text } : s))
      }}
    />
  )
}

function PhotoBody(props: WallStickerViewProps): React.JSX.Element {
  const { sticker, editing, onEdit, onChange, rootPath, rect } = props
  const file = sticker.kind === 'photo' ? sticker.file : ''
  const url = useWallImage(rootPath, file)
  if (sticker.kind !== 'photo') return <></>
  const imgH = rect.h - 34
  return (
    <>
      {url === null ? (
        <div className="wiki-wall-photo-missing" style={{ height: imgH }}>
          图片读不出来
        </div>
      ) : (
        <img
          className="wiki-wall-photo-img"
          src={url}
          alt={sticker.caption}
          draggable={false}
          style={{ height: imgH }}
        />
      )}
      {editing ? (
        <input
          className="wiki-wall-photo-input"
          autoFocus
          maxLength={WALL_CAPTION_MAX}
          value={sticker.caption}
          placeholder="给图片写句说明"
          onPointerDown={stop}
          onClick={stop}
          onDoubleClick={stop}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' || event.key === 'Escape') onEdit(false)
          }}
          onBlur={blurOut(onEdit)}
          onChange={(event) => {
            const caption = event.target.value
            onChange((s) => (s.kind === 'photo' ? { ...s, caption } : s))
          }}
        />
      ) : (
        <span className={`wiki-wall-photo-caption${sticker.caption === '' ? ' is-empty' : ''}`}>
          {sticker.caption === '' ? '双击写说明' : sticker.caption}
        </span>
      )}
    </>
  )
}
