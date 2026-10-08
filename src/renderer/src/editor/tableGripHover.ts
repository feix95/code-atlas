/**
 * 抓手现身热区(Obsidian 同款):
 * 列抓手只在鼠标贴近表格顶边时现身、对准鼠标所在那一列;行抓手只在鼠标贴近表格左边时现身、
 * 对准鼠标所在那一行;鼠标在格子中间移动不现身。按几何位置判定而不看事件目标 ——
 * 边框和表格上沿的缝隙上事件目标不是格子,看目标会漏判。
 */

/**
 * 热区厚度(以表格字号 em 计):
 * 外侧 = 抓手图标所在的槽(表格外),要罩住整个图标;内侧 = 只留边框那一线,
 * 鼠标在格子里面时不现身。
 */
export const GRIP_HOT_ZONE_OUTER_EM = 1.5
export const GRIP_HOT_ZONE_INNER_EM = 0.3

/** 列抓手上方感应带的高度(em):只罩到抓手探出的那一截,别压到上一段正文太多 */
const GRIP_COL_ZONE_EM = 1.1

/** 热区厚度(px):离表格边缘向外/向内各多远算「明确要去拖」 */
export interface GripZone {
  outer: number
  inner: number
}

/** 一维区间 [start, end) */
export interface Span {
  start: number
  end: number
}

export interface GripHit {
  /** 命中的表头列下标;未贴近顶边为 null */
  col: number | null
  /** 命中的数据行下标(不含表头);未贴近左边为 null */
  row: number | null
}

const indexOfSpan = (spans: readonly Span[], value: number): number | null => {
  const index = spans.findIndex((s) => value >= s.start && value < s.end)
  return index < 0 ? null : index
}

/**
 * 纯几何判定(node 自测直接驱动)。
 * pointer:鼠标坐标;tableTop/tableLeft:表格上沿/左沿;
 * headCols:各表头列的横向区间;bodyRows:各数据行的纵向区间;zone:热区厚度(px)。
 * 热区是表格边缘向外 outer、向内 inner 的一条带:列看顶边,行看左边。
 */
export function gripHitTest(args: {
  pointer: { x: number; y: number }
  tableTop: number
  tableLeft: number
  headCols: readonly Span[]
  bodyRows: readonly Span[]
  zone: GripZone
}): GripHit {
  const { pointer, tableTop, tableLeft, headCols, bodyRows, zone } = args
  const nearTop = pointer.y >= tableTop - zone.outer && pointer.y <= tableTop + zone.inner
  const nearLeft = pointer.x >= tableLeft - zone.outer && pointer.x <= tableLeft + zone.inner
  return {
    col: nearTop ? indexOfSpan(headCols, pointer.x) : null,
    row: nearLeft ? indexOfSpan(bodyRows, pointer.y) : null
  }
}

/**
 * 外侧感应带:抓手图标画在表格外的槽里,而鼠标事件只送到容器范围内 ——
 * 不铺这两条透明带,鼠标一走向图标就离开容器、抓手当场熄灭(够不着)。
 * 带子只管把事件送回容器,现身与否仍由几何热区判定。
 */
export function makeGripZones(doc: Document): HTMLElement[] {
  const rowZone = doc.createElement('div')
  rowZone.className = 'cm-live-grip-zone'
  rowZone.style.cssText = `top:0;bottom:0;left:-${GRIP_HOT_ZONE_OUTER_EM}em;width:${GRIP_HOT_ZONE_OUTER_EM}em`
  const colZone = doc.createElement('div')
  colZone.className = 'cm-live-grip-zone'
  colZone.style.cssText = `left:0;right:0;top:-${GRIP_COL_ZONE_EM}em;height:${GRIP_COL_ZONE_EM}em`
  return [rowZone, colZone]
}

export interface GripTargets {
  /** 列抓手当前对准的表头格 */
  colCell: () => HTMLElement | null
  /** 行抓手当前对准的数据行 */
  rowRow: () => HTMLElement | null
}

const spanOf = (el: HTMLElement, axis: 'x' | 'y'): Span => {
  const r = el.getBoundingClientRect()
  return axis === 'x' ? { start: r.left, end: r.right } : { start: r.top, end: r.bottom }
}

/** 给一张表挂抓手悬停逻辑:鼠标移动时按热区点亮/熄灭两个抓手,并把它们贴到对应行列 */
export function attachGripHover(
  box: HTMLElement,
  tableEl: HTMLElement,
  rowGrip: HTMLElement,
  colGrip: HTMLElement,
  isDragging: () => boolean
): GripTargets {
  let colCell: HTMLElement | null = null
  let rowRow: HTMLElement | null = null

  const hideBoth = (): void => {
    colCell = rowRow = null
    colGrip.classList.remove('is-on')
    rowGrip.classList.remove('is-on')
  }

  box.addEventListener('mousemove', (e) => {
    if (isDragging()) return
    // 鼠标已在抓手本身上:保持现状,别因为离开格子区域把它熄了
    if ((e.target as Element | null)?.closest?.('.cm-live-grip')) return
    const headCells = [...tableEl.querySelectorAll<HTMLElement>('thead th')]
    const bodyRows = [...tableEl.querySelectorAll<HTMLElement>('tbody tr')]
    const tableRect = tableEl.getBoundingClientRect()
    const fontPx = parseFloat(box.ownerDocument.defaultView?.getComputedStyle(box).fontSize ?? '16')
    const zone = { outer: GRIP_HOT_ZONE_OUTER_EM * fontPx, inner: GRIP_HOT_ZONE_INNER_EM * fontPx }
    const hit = gripHitTest({
      pointer: { x: e.clientX, y: e.clientY },
      tableTop: tableRect.top,
      tableLeft: tableRect.left,
      headCols: headCells.map((c) => spanOf(c, 'x')),
      bodyRows: bodyRows.map((r) => spanOf(r, 'y')),
      zone
    })
    const boxRect = box.getBoundingClientRect()
    colCell = hit.col === null ? null : headCells[hit.col]
    rowRow = hit.row === null ? null : bodyRows[hit.row]
    colGrip.classList.toggle('is-on', colCell !== null)
    rowGrip.classList.toggle('is-on', rowRow !== null)
    if (colCell) {
      const r = colCell.getBoundingClientRect()
      colGrip.style.left = `${r.left - boxRect.left + r.width / 2}px`
    }
    if (rowRow) {
      const r = rowRow.getBoundingClientRect()
      rowGrip.style.top = `${r.top - boxRect.top + r.height / 2}px`
    }
  })

  box.addEventListener('mouseleave', (e) => {
    // 从格子滑向抓手也会触发离开:目标是控件层内的就别熄
    if (
      e.relatedTarget instanceof Node &&
      box.querySelector('.cm-live-table-ui')?.contains(e.relatedTarget)
    )
      return
    if (!isDragging()) hideBoth()
  })

  return { colCell: () => colCell, rowRow: () => rowRow }
}
