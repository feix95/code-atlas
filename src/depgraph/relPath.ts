/** 把路径段归一化(处理 ./ 和 ../),全用 '/' 分隔;上跳出项目根返回 null */
export function normalizeParts(parts: string[]): string[] | null {
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out
}

/** 配置里写的相对路径 → 项目根相对路径;绝对路径、盘符、上跳出根一律不可用(null) */
export function toProjectRel(base: string, path: string): string | null {
  const unified = path.replaceAll('\\', '/')
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) return null
  const parts = normalizeParts([...base.split('/'), ...unified.split('/')])
  return parts ? parts.join('/') : null
}
