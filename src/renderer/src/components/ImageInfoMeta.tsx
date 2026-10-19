import { useState } from 'react'
import type { FilePreviewImage } from '@shared/types'
import { imageInfoFacts } from '@shared/imageMeta'

/**
 * 底栏像素/体积块:按住左键弹出文件头信息,松开即收。
 * 指针捕获保证拖出热区再松手也会关掉。
 */
export function ImageInfoMeta({
  image,
  dims,
  sizeText
}: {
  image: FilePreviewImage
  dims: string | null
  sizeText: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const facts = imageInfoFacts(image)

  function onPointerDown(e: React.PointerEvent<HTMLSpanElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      return
    }
    setOpen(true)
  }

  function onPointerUp(): void {
    setOpen(false)
  }

  return (
    <span
      className="image-chip image-info-meta"
      aria-label="按住查看图片信息"
      aria-expanded={open}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {dims && <span>{dims}</span>}
      <span>{sizeText}</span>
      {open && (
        <div className="image-info-peek" role="status">
          {facts.map((row) => (
            <div key={row.label} className="image-info-peek-row">
              <span className="image-info-peek-label">{row.label}</span>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
