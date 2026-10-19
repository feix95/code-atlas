import { useCallback, useState } from 'react'
import type { FilePreviewImage } from '@shared/types'
import type { RenameOutcome } from '@shared/fileRename'
import { formatSize } from '@shared/fsMessages'
import { useImageViewport } from '../useImageViewport'
import type { ImageSize } from '@shared/imageZoom'
import { ImageFileName } from './ImageFileName'
import { ImageInfoMeta } from './ImageInfoMeta'
import { ImageZoomControl, type ImageZoomMenu } from './ImageZoomControl'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

/** 图片解码的两档账:字节进 <img> 后,要么上屏要么报错,没有中间态 */
type ImagePhase = 'loading' | 'ready' | 'error'

function metaSize(image: FilePreviewImage): ImageSize | null {
  if (image.width === null || image.height === null) return null
  if (image.width <= 0 || image.height <= 0) return null
  return { width: image.width, height: image.height }
}

/**
 * 图片预览:JPG/PNG 文件签的正文。
 * 默认适应窗口(小图不放大);Ctrl+滚轮以光标为中心缩放;拖拽平移;
 * 双击图片在适应窗口 / 100% 之间切换;底栏百分比单击选档、双击输入;
 * 图片上右键在光标处弹出同一份缩放档位菜单;底栏文件名双击改主名(扩展名保留)。
 * 不碰代码那套只读/引用/折行。
 */
export function ImagePreview({
  fileName,
  image,
  onRename
}: {
  fileName: string
  image: FilePreviewImage
  onRename?: (base: string) => Promise<RenameOutcome>
}): React.JSX.Element {
  const [phase, setPhase] = useState<ImagePhase>('loading')
  const [natural, setNatural] = useState<ImageSize | null>(() => metaSize(image))
  const {
    stageRef,
    view,
    isPanning,
    canPan,
    zoomPercent,
    setZoomPercent,
    onPointerDown,
    onDoubleClick
  } = useImageViewport(natural)
  const [zoomMenu, setZoomMenu] = useState<ImageZoomMenu>({ kind: 'closed' })
  const openChipMenu = useCallback((): void => {
    if (phase !== 'ready') return
    setZoomMenu({ kind: 'chip' })
  }, [phase])
  const closeZoomMenu = useCallback((): void => setZoomMenu({ kind: 'closed' }), [])
  const dims =
    image.width !== null && image.height !== null ? `${image.width} × ${image.height} 像素` : null
  const stageClass =
    'image-stage' + (canPan ? ' is-pannable' : '') + (isPanning ? ' is-panning' : '')

  function onStageContextMenu(e: React.MouseEvent<HTMLDivElement>): void {
    e.preventDefault()
    if (phase !== 'ready') return
    setZoomMenu({ kind: 'cursor', x: e.clientX, y: e.clientY })
  }

  return (
    <div className="image-pane">
      <div
        ref={stageRef}
        className={stageClass}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={onStageContextMenu}
      >
        {phase === 'error' ? (
          <Notice kind="warn">
            这张图片打不开 —— 文件可能已损坏,或内容不是有效的 JPG/PNG 编码
          </Notice>
        ) : (
          <img
            className="image-figure"
            src={image.dataUrl}
            alt={fileName}
            draggable={false}
            hidden={phase !== 'ready'}
            width={natural?.width}
            height={natural?.height}
            style={
              natural
                ? {
                    transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`
                  }
                : undefined
            }
            onLoad={(e) => {
              const img = e.currentTarget
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setNatural({ width: img.naturalWidth, height: img.naturalHeight })
              }
              setPhase('ready')
            }}
            onError={() => setPhase('error')}
          />
        )}
        {phase === 'loading' && (
          <div className="image-wait">
            <ProgressDots />
            正在加载图片……
          </div>
        )}
      </div>
      <div className="image-info">
        <ImageFileName fileName={fileName} onRename={onRename} />
        <ImageInfoMeta image={image} dims={dims} sizeText={formatSize(image.bytes)} />
        <ImageZoomControl
          percent={zoomPercent}
          disabled={phase !== 'ready'}
          menu={zoomMenu}
          onMenuOpen={openChipMenu}
          onMenuClose={closeZoomMenu}
          onPick={setZoomPercent}
        />
      </div>
    </div>
  )
}
