/** 工作区菜单超长路径的中间省略:纯函数,不碰 DOM(自测见 scripts/selftest-pathellipsis.mts)。
 *
 * 盘符/根与末段文件夹同时保留,中间整段文件夹收成 `…`;装得下则原样返回。
 * 完整路径由调用方用悬停提示兜底,这里不负责。
 */

const ELLIPSIS = '…'

interface DisplayPath {
  /** `E:\` / `/` / 相对路径为空串;根自带分隔符 */
  root: string
  segs: string[]
  sep: string
}

function splitDisplayPath(path: string): DisplayPath {
  const drive = path.match(/^([A-Za-z]:)[\\/]/)
  if (drive) {
    const sep = path[drive[0].length - 1] === '/' ? '/' : '\\'
    const segs = path
      .slice(drive[0].length)
      .split(/[\\/]/)
      .filter((s) => s.length > 0)
    return { root: `${drive[1]}${sep}`, segs, sep }
  }
  if (path.startsWith('/')) {
    return {
      root: '/',
      segs: path.split('/').filter((s) => s.length > 0),
      sep: '/'
    }
  }
  const sep = path.includes('\\') ? '\\' : '/'
  return { root: '', segs: path.split(/[\\/]/).filter((s) => s.length > 0), sep }
}

function collapsedPath(root: string, headSegs: string[], last: string, sep: string): string {
  const head = headSegs.join(sep)
  const left = head ? `${root}${head}${sep}` : root
  return `${left}${ELLIPSIS}${sep}${last}`
}

/** 末尾加省略号,尽量多留开头;宽不够时只回 `…` */
function truncateEnd(text: string, maxWidth: number, measure: (t: string) => number): string {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return ELLIPSIS
  if (measure(text) <= maxWidth) return text
  if (measure(ELLIPSIS) >= maxWidth) return ELLIPSIS
  let lo = 0
  let hi = text.length
  let best = ELLIPSIS
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const candidate = text.slice(0, mid) + ELLIPSIS
    if (measure(candidate) <= maxWidth) {
      best = candidate
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

/**
 * 按可视宽度把路径收成中间省略。`measure` 返回文本像素宽(自测可用字符数)。
 * 宽不可用时原样返回,交给 CSS 裁切兜底。
 */
export function ellipsisMiddlePath(
  path: string,
  maxWidth: number,
  measure: (text: string) => number
): string {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return path
  if (measure(path) <= maxWidth) return path

  const { root, segs, sep } = splitDisplayPath(path)
  const last = segs.at(-1)
  if (!last) return truncateEnd(path, maxWidth, measure)

  const left = segs.slice(0, -1)
  if (left.length === 0) return truncateEnd(path, maxWidth, measure)

  for (let keep = left.length - 1; keep >= 0; keep--) {
    const label = collapsedPath(root, left.slice(0, keep), last, sep)
    if (measure(label) <= maxWidth) return label
  }

  const compact = collapsedPath(root, [], last, sep)
  const prefix = compact.slice(0, compact.length - last.length)
  const fitted = prefix + truncateEnd(last, maxWidth - measure(prefix), measure)
  if (measure(fitted) <= maxWidth) return fitted
  return truncateEnd(path, maxWidth, measure)
}
