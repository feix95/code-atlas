// 卡片墙排版的小工具:可复现的种子,以及「允许轻微叠压」的矩形推开。纯函数,不依赖界面。

/** 稳定的 0 到 1 伪随机数:同一字符串永远得到同一个值(FNV-1a) */
export function wallSeed(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 100000) / 100000
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 两个盒子压得是否超过允许比例;超过就给出把 b 推开所需的位移(沿穿插更浅的方向) */
function push(a: Box, b: Box, m: number): { x: number; y: number } | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const ox = ((a.w + b.w) / 2) * m - Math.abs(dx)
  const oy = ((a.h + b.h) / 2) * m - Math.abs(dy)
  if (ox <= 0 || oy <= 0) return null
  if (ox / (a.w + b.w) < oy / (a.h + b.h)) return { x: (dx >= 0 ? 1 : -1) * ox, y: 0 }
  return { x: 0, y: (dy >= 0 ? 1 : -1) * oy }
}

/** 反复两两推开,直到没有压过头的;用网格分桶,只查邻近格子 */
export function settle(
  boxes: Box[],
  marginOf: (i: number, j: number) => number,
  rounds: number
): void {
  const cell = boxes.reduce((max, box) => Math.max(max, box.w, box.h), 1) * 1.2
  for (let round = 0; round < rounds; round += 1) {
    const buckets = new Map<string, number[]>()
    boxes.forEach((box, i) => {
      const key = `${Math.floor(box.x / cell)},${Math.floor(box.y / cell)}`
      const list = buckets.get(key)
      if (list) list.push(i)
      else buckets.set(key, [i])
    })
    let moved = false
    boxes.forEach((a, i) => {
      const cx = Math.floor(a.x / cell)
      const cy = Math.floor(a.y / cell)
      for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
        for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
          for (const j of buckets.get(`${gx},${gy}`) ?? []) {
            if (j <= i) continue
            const b = boxes[j]
            const v = push(a, b, marginOf(i, j))
            if (v === null) continue
            moved = true
            a.x -= v.x / 2
            a.y -= v.y / 2
            b.x += v.x / 2
            b.y += v.y / 2
          }
        }
      }
    })
    if (!moved) return
  }
}
