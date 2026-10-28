// 模块轮廓的几何:Andrew 单调链凸包,以及「一组圆外扩 padding 后的凸包」(圆周采样再求凸包,
// 采样点够密时拐角自然是圆角)。纯函数,不依赖 DOM。
export type Point = [number, number]

export interface Circle {
  x: number
  y: number
  r: number
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/** 凸包顶点,逆时针,从 x 最小(并列取 y 最小)的点开始;共线点不保留 */
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const half = (list: Point[]): Point[] => {
    const out: Point[] = []
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  const hull = [...half(sorted), ...half([...sorted].reverse())]
  return hull.length > 2 ? hull : hull.slice(0, 2)
}

/** 圆周按 samples 等分采样(半径 r + padding)后的凸包 */
export function circleHull(circles: Circle[], padding: number, samples: number): Point[] {
  const points: Point[] = []
  // 采样点落在外切多边形上(半径除以 cos(半角)),保证真正的圆周整个落在轮廓内
  const stretch = 1 / Math.cos(Math.PI / samples)
  for (const c of circles) {
    const radius = (c.r + padding) * stretch
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * Math.PI * 2
      points.push([c.x + Math.cos(t) * radius, c.y + Math.sin(t) * radius])
    }
  }
  return convexHull(points)
}
