import { useState } from 'react'
import type { FilePreviewImage } from '@shared/types'
import { formatSize } from '@shared/fsMessages'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

/** 图片解码的两档账:字节进 <img> 后,要么上屏要么报错,没有中间态 */
type ImagePhase = 'loading' | 'ready' | 'error'

/** 看图两档:适应窗口(默认,整图居中)/ 100% 原尺寸(可滚动) */
type ImageZoom = 'fit' | 'actual'

/**
 * 图片预览(图片预览锤):JPG/PNG 文件签的正文。
 * 默认适应窗口居中看整张;点图或点底栏模式钮在「适应窗口 / 100%」间切换,
 * 100% 下撑出滚动条看原尺寸。底栏信息条报文件名、宽×高(读不出就不说)、体积。
 * 图片不碰代码那套 —— 只读锁/引用/折行一概不出场。
 */
export function ImagePreview({
  fileName,
  image
}: {
  fileName: string
  image: FilePreviewImage
}): React.JSX.Element {
  const [phase, setPhase] = useState<ImagePhase>('loading')
  const [zoom, setZoom] = useState<ImageZoom>('fit')
  const dims =
    image.width !== null && image.height !== null ? `${image.width} × ${image.height} 像素` : null
  const zoomTip =
    zoom === 'fit' ? '现在是适应窗口,点一下看 100% 原尺寸' : '现在是 100% 原尺寸,点一下适应窗口'

  function toggleZoom(): void {
    setZoom((z) => (z === 'fit' ? 'actual' : 'fit'))
  }

  return (
    <div className="image-pane">
      <div className={`image-stage${zoom === 'actual' ? ' is-actual' : ''}`}>
        {phase === 'error' ? (
          <Notice kind="warn">
            这张图片打不开 —— 文件可能已损坏,或内容不是有效的 JPG/PNG 编码
          </Notice>
        ) : (
          <button
            type="button"
            className="image-stage-btn"
            aria-label={zoomTip}
            data-tip={zoomTip}
            onClick={toggleZoom}
          >
            <img
              className="image-figure"
              src={image.dataUrl}
              alt={fileName}
              draggable={false}
              hidden={phase !== 'ready'}
              onLoad={() => setPhase('ready')}
              onError={() => setPhase('error')}
            />
          </button>
        )}
        {phase === 'loading' && (
          <div className="image-wait">
            <ProgressDots />
            正在加载图片……
          </div>
        )}
      </div>
      <div className="image-info">
        <span className="image-info-name" data-tip={fileName}>
          {fileName}
        </span>
        {dims && <span>{dims}</span>}
        <span>{formatSize(image.bytes)}</span>
        <button
          type="button"
          className="image-zoom-btn"
          aria-pressed={zoom === 'actual'}
          aria-label={zoomTip}
          data-tip={zoomTip}
          onClick={toggleZoom}
        >
          {zoom === 'fit' ? '适应窗口' : '100%'}
        </button>
      </div>
    </div>
  )
}
