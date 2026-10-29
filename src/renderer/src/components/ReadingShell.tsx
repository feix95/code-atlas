import type { ReactNode } from 'react'
import { useLayoutEffect } from 'react'
import { useDocOutline } from '../useDocOutline'
import { publishOutline, setOutlineDocked, unpublishOutline } from '../outlineDock'
import { useOutlineDock } from '../useOutlineDock'
import { DocOutline } from './DocOutline'

/**
 * 阅读档的外壳(md 阅读档、文档族对照、Word 预览三处共用):
 * 可滚动的 .code-view.is-reading + 居中可读栏 .code-reading;
 * 传了 outlineKey 就从正文里收标题挂大纲浮窗,正文换了(key 变)重收,没有标题不出窗。
 * 大纲坞是阅读栏的兄弟、挂在预览面板(.code-pane)上:浮窗能拖到页头之上,也不会被正文的滚动裁掉。
 * 传了 outlineOwner(页签 id)就把标题与跳转口发布成快照 —— 停靠到左栏时由那边接着画,
 * 浮窗退场但标题照收、滚动照跟;拆去子窗的那棵树上没有左栏,浮窗照常站岗。
 */
export function ReadingShell({
  viewRef,
  docZoom,
  label,
  outlineKey,
  outlineOwner,
  outlineDockOwner,
  onContextMenu,
  onKeyDown,
  children
}: {
  viewRef: React.RefObject<HTMLDivElement | null>
  docZoom: number
  label: string
  /** 正文内容的指纹(md 传文稿、Word 传网页);不传 = 这份视图不要大纲 */
  outlineKey?: string
  /** 这扇预览的页签 id:大纲快照按它登记,也是停靠位的身份 */
  outlineOwner?: string
  /** 当前停靠位认的那张签(App 按主窗激活组算):对上了浮窗才让位 */
  outlineDockOwner?: string | null
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}): React.JSX.Element {
  const { items, activeId, jumpTo } = useDocOutline(viewRef, outlineKey)
  const dock = useOutlineDock(viewRef, outlineOwner, outlineDockOwner ?? null)

  useLayoutEffect(() => {
    if (outlineOwner === undefined) return
    publishOutline(outlineOwner, { items, activeId, jumpTo })
  }, [outlineOwner, items, activeId, jumpTo])
  useLayoutEffect(() => {
    if (outlineOwner === undefined) return
    return () => unpublishOutline(outlineOwner)
  }, [outlineOwner])

  return (
    <>
      <div
        className="code-view is-reading"
        ref={viewRef}
        tabIndex={0}
        style={{ '--doc-zoom': docZoom } as React.CSSProperties}
        aria-label={label}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        <article className="code-reading">{children}</article>
      </div>
      {items.length > 0 && !dock.hidden && (
        <DocOutline
          viewRef={viewRef}
          items={items}
          activeId={activeId}
          onJump={jumpTo}
          canDock={dock.canDock}
          onDock={() => setOutlineDocked(true)}
          dropTarget={dock.dropTarget}
        />
      )}
    </>
  )
}
