/** 格内「装饰源码」渲染与光标账:记号藏而不删,textContent 恒等于源码 */
// ── 装饰源码渲染:记号藏而不删 ──

/** 格内行内语法总闸:`代码`、粗体两档、斜体两档、删除线、高亮、链接 —— 与 parseRich 同一张正则桌 */
const RE_CELL_INLINE =
  /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|(?<![\w])_([^_\n]+)_(?![\w])|~~([^~]+)~~|==([^=]+)==|\[([^\]]+)\]\(([^)]+)\)/g

/** 一个行内记号 → 装饰源码 DOM:定界符藏 .cm-live-cell-delim,内核吃文档同款 .cm-live-* 皮 */
function cellMarkDom(m: RegExpMatchArray, doc: Document): HTMLElement {
  const wrap = doc.createElement('span')
  wrap.className = 'cm-live-cell-wrap'
  const delim = (t: string): HTMLElement => {
    const d = doc.createElement('span')
    d.className = 'cm-live-cell-delim'
    d.textContent = t
    return d
  }
  const inner = (cls: string, t: string): HTMLElement => {
    const s = doc.createElement('span')
    s.className = cls
    s.textContent = t
    return s
  }
  if (m[1] !== undefined) {
    wrap.append(delim('`'), inner('cm-live-code', m[1]), delim('`'))
  } else if (m[2] !== undefined || m[3] !== undefined) {
    const d = m[2] !== undefined ? '**' : '__'
    wrap.append(delim(d), inner('cm-live-strong', m[2] ?? m[3] ?? ''), delim(d))
  } else if (m[4] !== undefined || m[5] !== undefined) {
    const d = m[4] !== undefined ? '*' : '_'
    wrap.append(delim(d), inner('cm-live-em', m[4] ?? m[5] ?? ''), delim(d))
  } else if (m[6] !== undefined) {
    wrap.append(delim('~~'), inner('cm-live-del', m[6]), delim('~~'))
  } else if (m[7] !== undefined) {
    wrap.append(delim('=='), inner('cm-live-mark', m[7]), delim('=='))
  } else {
    wrap.append(delim('['), inner('cm-live-link', m[8] ?? ''), delim(`](${m[9] ?? ''})`))
  }
  return wrap
}

/** 格子源码 → 装饰 DOM(可重入,commit 每键重画一遍) */
export function renderCellSource(src: HTMLElement, raw: string, doc: Document): void {
  src.textContent = ''
  let last = 0
  for (const m of raw.matchAll(RE_CELL_INLINE)) {
    if (m.index > last) src.appendChild(doc.createTextNode(raw.slice(last, m.index)))
    src.appendChild(cellMarkDom(m, doc))
    last = m.index + m[0].length
  }
  if (last < raw.length) src.appendChild(doc.createTextNode(raw.slice(last)))
}

// ── 光标账:以 textContent 字符偏移记账,装饰重画后能落回原位 ──

export function getCaretCharOffset(el: HTMLElement): number | null {
  const sel = el.ownerDocument?.defaultView?.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const r = sel.getRangeAt(0)
  if (!el.contains(r.startContainer)) return null
  const pre = r.cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(r.startContainer, r.startOffset)
  return pre.toString().length
}

export function setCaretCharOffset(el: HTMLElement, offset: number): void {
  const doc = el.ownerDocument
  const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */)
  let rest = offset
  let target: Text | null = null
  let off = 0
  let node = walker.nextNode() as Text | null
  while (node) {
    if (rest <= node.data.length) {
      target = node
      off = rest
      break
    }
    rest -= node.data.length
    node = walker.nextNode() as Text | null
  }
  const sel = doc.defaultView?.getSelection()
  if (!sel) return
  const r = doc.createRange()
  if (target) {
    r.setStart(target, off)
    r.collapse(true)
  } else {
    r.selectNodeContents(el)
    r.collapse(false)
  }
  sel.removeAllRanges()
  sel.addRange(r)
}

export function placeCaretAtEnd(el: HTMLElement): void {
  const doc = el.ownerDocument
  const r = doc.createRange()
  r.selectNodeContents(el)
  r.collapse(false)
  const sel = doc.defaultView?.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  sel.addRange(r)
}

/** 光标进了哪几层记号就掀开哪几层的定界符(离场时全部关闭) */
export function refreshActiveMarks(src: HTMLElement): void {
  src.querySelectorAll('.cm-live-cell-wrap.active').forEach((w) => w.classList.remove('active'))
  const sel = src.ownerDocument?.defaultView?.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const anchor = sel.anchorNode
  if (!anchor || !src.contains(anchor)) return
  let n: Node | null = anchor
  while (n && n !== src) {
    // 鸭式判断:子窗是独立 realm,instanceof HTMLElement 会误判
    if (n.nodeType === 1 && (n as HTMLElement).classList?.contains('cm-live-cell-wrap'))
      (n as HTMLElement).classList.add('active')
    n = n.parentNode
  }
}
