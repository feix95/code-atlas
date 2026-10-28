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
