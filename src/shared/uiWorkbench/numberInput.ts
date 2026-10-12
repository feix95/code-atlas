// 属性面板数值输入的统一解析:取整、钳到 [min, max];空串或非数字返回 null(调用方保留原值)。

export function parseIntegerInput(raw: string, min: number, max: number): number | null {
  const text = raw.trim()
  const value = Number(text)
  if (text === '' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.round(value)))
}
