// 对照稿:原文与译文共用同一份块序号,按块渲染 —— 悬停谁,两块同号的一起亮。
// 块外壳(data-md-block)是唯一的对号凭证,别在外层再包一层打乱序号。
import type { FileLinkTarget } from '@shared/fileLinks'
import type { MdBlockSlice } from '@shared/mdBlocks'
import { MiniMD } from './MiniMD'

export function LinkedMdView({
  blocks,
  texts,
  hovered,
  onHover,
  fileLinks
}: {
  blocks: MdBlockSlice[]
  /** 每块的正文;空串 = 还没翻好,摆骨架 */
  texts: string[]
  hovered: number | null
  onHover: (block: number | null) => void
  fileLinks?: FileLinkTarget
}): React.JSX.Element {
  return (
    <div className="md md-linked" onPointerLeave={() => onHover(null)}>
      {blocks.map((block) => {
        const text = texts[block.index] ?? ''
        const isHot = hovered === block.index
        return (
          <div
            key={block.index}
            className={`md-block${text === '' ? ' is-pending' : ''}${isHot ? ' is-linked-hover' : ''}`}
            data-md-block={block.index}
            onPointerEnter={() => onHover(block.index)}
          >
            {text === '' ? (
              <div className="md-block-skeleton" aria-hidden="true" />
            ) : (
              <MiniMD bare text={text} fileLinks={fileLinks} />
            )}
          </div>
        )
      })}
    </div>
  )
}
