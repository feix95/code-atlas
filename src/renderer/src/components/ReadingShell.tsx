import type { ReactNode } from 'react'
import { useDocOutline } from '../useDocOutline'
import { DocOutline } from './DocOutline'

/**
 * 阅读档的外壳(md 阅读档、文档族对照、Word 预览三处共用):
 * 可滚动的 .code-view.is-reading + 居中可读栏 .code-reading;
 * 传了 outlineKey 就从正文里收标题挂大纲浮窗,正文换了(key 变)重收,没有标题不出窗。
 */
export function ReadingShell({
  viewRef,
  docZoom,
  label,
  outlineKey,
  onContextMenu,
  onKeyDown,
  children
}: {
  viewRef: React.RefObject<HTMLDivElement | null>
  docZoom: number
  label: string
  /** 正文内容的指纹(md 传文稿、Word 传网页);不传 = 这份视图不要大纲 */
  outlineKey?: string
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}): React.JSX.Element {
  const { items, activeId, jumpTo } = useDocOutline(viewRef, outlineKey)
  return (
    <div
      className="code-view is-reading"
      ref={viewRef}
      tabIndex={0}
      style={{ '--doc-zoom': docZoom } as React.CSSProperties}
      aria-label={label}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      {items.length > 0 && (
        <DocOutline viewRef={viewRef} items={items} activeId={activeId} onJump={jumpTo} />
      )}
      <article className="code-reading">{children}</article>
    </div>
  )
}
