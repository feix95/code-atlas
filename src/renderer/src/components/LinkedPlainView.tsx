// 文档族对照稿:分段纯文本,不走 MiniMD(纯文本里的 # * 不能当成 Markdown)。
// 块外壳(data-md-block)与 LinkedMdView 同一套,悬停/滚动对号才能接着用。
import type { MdBlockSlice } from '@shared/mdBlocks'

export function LinkedPlainView({
  blocks,
  texts,
  hovered,
  onHover
}: {
  blocks: MdBlockSlice[]
  texts: string[]
  hovered: number | null
  onHover: (block: number | null) => void
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
              <pre className="md-plain">{text}</pre>
            )}
          </div>
        )
      })}
    </div>
  )
}
