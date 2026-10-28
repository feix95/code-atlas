// 文档大纲的取数规矩(Word 预览与 md 阅读档共用一份):
// 不再解析一遍源文件,直接从已经上屏的正文里认标题 —— 两边的标题都挂着阅读档类名
// .md-h + .md-h1~6(md 由 MiniMD 画,Word 由 docxSanitize 消毒后挂上),认这一套就够。
// 只认真标题:Word 的「标题 1/2…」样式、md 的 #;加粗的普通段落不算。

export interface OutlineItem {
  /** 本篇内唯一、同一份正文每次算都一样的编号(挂在标题元素的 data-outline-id 上) */
  id: string
  /** 1~6 */
  level: number
  text: string
}

export const OUTLINE_ATTR = 'data-outline-id'

const LEVEL_CLASS = /(?:^|\s)md-h([1-6])(?:\s|$)/
const NON_WORD = /[^\p{L}\p{N}]+/gu
const FALLBACK_SLUG = 'section'

/** 标题元素是第几级;不是阅读档标题回 null */
export function headingLevelOf(el: Element): number | null {
  const hit = LEVEL_CLASS.exec(el.getAttribute('class') ?? '')
  return hit ? Number(hit[1]) : null
}

function slugOf(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(NON_WORD, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? FALLBACK_SLUG : slug
}

/**
 * 按标题文字排编号(纯函数):中英文字母数字保留、其余收成连字符;
 * 重名的从第二个起挂 -2、-3,同一份正文每次算出来都一样。
 */
export function outlineIds(texts: string[]): string[] {
  const seen = new Map<string, number>()
  return texts.map((text) => {
    const base = `outline-${slugOf(text)}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base}-${count}`
  })
}

/** 从已上屏的正文里收大纲,顺手给每个标题挂上编号;没有标题回空数组 */
export function collectOutline(root: Element): OutlineItem[] {
  const found: Array<{ el: Element; level: number; text: string }> = []
  for (const el of root.querySelectorAll('.md-h')) {
    const level = headingLevelOf(el)
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (level !== null && text !== '') found.push({ el, level, text })
  }
  const ids = outlineIds(found.map((h) => h.text))
  return found.map((h, i) => {
    h.el.setAttribute(OUTLINE_ATTR, ids[i])
    return { id: ids[i], level: h.level, text: h.text }
  })
}

/** 缩进档:按本篇出现过的最浅一级算起,只有 h2/h3 的文档不会整体空出一格 */
export function outlineDepths(items: OutlineItem[]): number[] {
  const top = Math.min(...items.map((item) => item.level))
  return items.map((item) => item.level - top)
}

/**
 * 滚动跟随(纯函数):哪个标题已经滚过「读线」(距视口顶 line 像素),最后一个就是当前节;
 * 第一个标题都还没到读线时回 null(还在开头导语里)。
 */
export function activeOutlineId(
  heads: Array<{ id: string; top: number }>,
  line: number
): string | null {
  let active: string | null = null
  for (const head of heads) {
    if (head.top > line) break
    active = head.id
  }
  return active
}
