// 输入舱里的待发原子:文件、图片、代码引用 —— 都躺在文字流里,各有各的 × 。
import { TreeIcon } from './Icons'
import { fileAttachRangeLabel } from '@shared/chatFiles'
import type { ChatImage } from '@shared/chatImage'
import type { ChatCodeRef } from '@shared/types'
import type { ChatImagesApi } from '../useChatImages'
import type { ChatFilesApi } from '../useChatFiles'

export function ComposerAtoms({
  chatFiles,
  chatImages,
  refs,
  onRemoveRef
}: {
  chatFiles: ChatFilesApi
  chatImages: ChatImagesApi
  refs: ChatCodeRef[]
  onRemoveRef?: (index: number) => void
}): React.JSX.Element {
  return (
    <>
      {/* 待发文件原子:文件名+行账躺在文字流里,× 移除;常驻,每轮都带上 */}
      {chatFiles.files.map((f) => (
        <span
          key={f.id}
          className="fc-file"
          data-tip={`${f.relPath ?? f.absPath ?? f.name} · ${fileAttachRangeLabel(f)}`}
        >
          <TreeIcon name="doc" size={12} mono />
          <span className="fc-file-text mono">{f.name}</span>
          <button
            type="button"
            className="fc-file-x"
            onClick={() => chatFiles.removeFile(f.id)}
            aria-label={`移除文件 ${f.name}`}
            data-tip="移除这个文件"
          >
            ✕
          </button>
        </span>
      ))}
      {/* 待发图片缩略原子:和引用原子一个排面,× 可键盘删 */}
      {chatImages.images.map((img: ChatImage) => (
        <span key={img.id} className="fc-img" data-tip={`${img.name} · ${img.width}×${img.height}`}>
          <img className="fc-img-thumb" src={img.dataUrl} alt={img.name} />
          <button
            type="button"
            className="fc-img-x"
            onClick={() => chatImages.removeImage(img.id)}
            aria-label={`移除图片 ${img.name}`}
            data-tip="移除这张图片"
          >
            ✕
          </button>
        </span>
      ))}
      {/* 内嵌引用原子(产品裁定):图标+底色躺在文字流里,光标顶头退格删最后一颗 */}
      {refs.map((r, i) => (
        <span
          key={`${r.relPath}-${r.startLine}-${r.endLine}-${i}`}
          className="fc-ref"
          data-tip={`${r.relPath} 第 ${r.startLine}-${r.endLine} 行`}
        >
          <svg
            className="fc-ref-ic"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
            <path d="m10 8-3 3 3 3" />
            <path d="m14 14 3-3-3-3" />
          </svg>
          <span className="fc-ref-text mono">
            {r.relPath.split('/').pop()}:{r.startLine}-{r.endLine}
          </span>
          <button
            type="button"
            className="fc-ref-x"
            onClick={() => onRemoveRef?.(i)}
            aria-label={`移除引用 ${r.relPath} 第 ${r.startLine}-${r.endLine} 行`}
            data-tip="移除这段引用"
          >
            ✕
          </button>
        </span>
      ))}
    </>
  )
}
