// 左侧栏 · 页面:文件里的多页列表(Figma Pages 同款)。点行切页、双击改名、拖行排序;
// 标题行的「+」新建页(继承当前页底色与画板尺寸),行尾「−」删页(至少留一页,删错靠撤销找回)。
import { useRef, useState } from 'react'
import { rowDropPosition } from '@shared/uiWorkbench/layers'
import { docActions, useDocState } from '../../uiWorkbench/documentStore'
import { dropMarkerClass, ROW_ATTR, useRowReorder } from '../../uiWorkbench/useRowReorder'
import { InlineName } from './InlineName'
import { MinusIcon, PlusIcon, RowButton } from './RowButton'

export function PagesPanel(): React.JSX.Element {
  const { pages, activePageId } = useDocState()
  const listRef = useRef<HTMLUListElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const { drag, startRow } = useRowReorder({
    listRef,
    onPress: (row) => docActions.switchPage(pages[row].id),
    onDrop: (fromRow, slot) => {
      const position = rowDropPosition(pages.length, fromRow, slot)
      if (position !== null) docActions.reorderPage(pages[fromRow].id, position)
    }
  })

  return (
    <section className="uwb-side-section uwb-pages" aria-label="页面">
      <div className="uwb-groups-head">
        <h3 className="uwb-section-title">页面</h3>
        <RowButton label="新建页面" icon={<PlusIcon />} onClick={docActions.addPage} />
      </div>
      <ul ref={listRef} className="uwb-layer-list">
        {pages.map((page, row) => (
          <li
            key={page.id}
            {...{ [ROW_ATTR]: '' }}
            className={`uwb-layer uwb-page-row${page.id === activePageId ? ' is-selected' : ''}${dropMarkerClass(drag, row, pages.length)}`}
            onPointerDown={(e) => startRow(e, row)}
            onDoubleClick={() => setEditingId(page.id)}
          >
            <InlineName
              value={page.name}
              label="页面名"
              className="uwb-layer-name"
              isEditing={editingId === page.id}
              onRename={(name) => docActions.patchPage(page.id, { name })}
              onStopEditing={() => setEditingId(null)}
            />
            {pages.length > 1 && (
              <RowButton
                label={`删除页面「${page.name}」`}
                icon={<MinusIcon />}
                onClick={() => docActions.removePage(page.id)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
