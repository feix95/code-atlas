/** 表格右键菜单:插入/删除行/列 */
import type { EditorView } from '@codemirror/view'
import { pinOverlayInViewport } from '../overlayLayout.ts'
import { dispatchModel, readModelFromDom } from './tableDom.ts'

// 右键菜单:插入/删除行/列

export function openCellMenu(view: EditorView, cell: HTMLElement, x: number, y: number): void {
  const wrap = cell.closest<HTMLElement>('.cm-live-table')
  if (!wrap) return
  const doc = view.dom.ownerDocument
  const isHeader = cell.tagName === 'TH'
  const tr = cell.closest('tr')
  const tbody = tr?.closest('tbody')
  const rowIdx = tr && tbody ? [...tbody.querySelectorAll('tr')].indexOf(tr) : -1
  const colIdx = tr ? [...tr.querySelectorAll('th, td')].indexOf(cell as HTMLTableCellElement) : -1

  const menu = doc.createElement('div')
  menu.className = 'file-path-menu cm-live-table-menu'
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`

  type MenuItem = { label: string; run: () => void } | 'sep'
  const items: MenuItem[] = []
  if (!isHeader) {
    items.push(
      {
        label: '在上方插入行',
        run: () => {
          const m = readModelFromDom(wrap)
          m.rows.splice(
            rowIdx,
            0,
            m.head.map(() => '')
          )
          dispatchModel(view, wrap, m)
        }
      },
      {
        label: '在下方插入行',
        run: () => {
          const m = readModelFromDom(wrap)
          m.rows.splice(
            rowIdx + 1,
            0,
            m.head.map(() => '')
          )
          dispatchModel(view, wrap, m)
        }
      },
      {
        label: '删除本行',
        run: () => {
          const m = readModelFromDom(wrap)
          if (rowIdx >= 0 && rowIdx < m.rows.length) m.rows.splice(rowIdx, 1)
          dispatchModel(view, wrap, m)
        }
      },
      'sep'
    )
  }
  items.push(
    {
      label: '在左侧插入列',
      run: () => {
        const m = readModelFromDom(wrap)
        m.head.splice(colIdx, 0, '')
        m.aligns.splice(colIdx, 0, 'left')
        m.rows.forEach((r) => r.splice(colIdx, 0, ''))
        dispatchModel(view, wrap, m)
      }
    },
    {
      label: '在右侧插入列',
      run: () => {
        const m = readModelFromDom(wrap)
        m.head.splice(colIdx + 1, 0, '')
        m.aligns.splice(colIdx + 1, 0, 'left')
        m.rows.forEach((r) => r.splice(colIdx + 1, 0, ''))
        dispatchModel(view, wrap, m)
      }
    },
    {
      label: '删除本列',
      run: () => {
        const m = readModelFromDom(wrap)
        if (m.head.length <= 1 || colIdx < 0) return // 删到零列表格就不是表了
        m.head.splice(colIdx, 1)
        m.aligns.splice(colIdx, 1)
        m.rows.forEach((r) => r.splice(colIdx, 1))
        dispatchModel(view, wrap, m)
      }
    }
  )

  let dismissed = false
  const dismiss = (): void => {
    if (dismissed) return
    dismissed = true
    menu.remove()
    doc.removeEventListener('mousedown', onDocDown, true)
    doc.removeEventListener('keydown', onDocKey, true)
  }
  const onDocDown = (e: MouseEvent): void => {
    if (e.target instanceof Node && menu.contains(e.target)) return
    dismiss()
  }
  const onDocKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismiss()
  }

  for (const it of items) {
    if (it === 'sep') {
      const sep = doc.createElement('div')
      sep.className = 'file-path-menu-sep'
      menu.appendChild(sep)
      continue
    }
    const b = doc.createElement('button')
    b.type = 'button'
    b.className = 'file-path-menu-item'
    const label = doc.createElement('span')
    label.className = 'fpm-label'
    label.textContent = it.label
    label.title = it.label
    b.appendChild(label)
    b.addEventListener('click', () => {
      it.run()
      dismiss()
    })
    menu.appendChild(b)
  }
  doc.body.appendChild(menu)

  const win = doc.defaultView
  if (win) pinOverlayInViewport(menu, x, y, win)

  // 延后一拍挂哨:当前这次 contextmenu 的 mousedown 还没走完,别把自己收掉
  setTimeout(() => {
    if (dismissed) return
    doc.addEventListener('mousedown', onDocDown, true)
    doc.addEventListener('keydown', onDocKey, true)
  })
}
