// ── 小探针形态机的几何判定(走出面板锤,2026-09-19)──
// 「页签被拖出主窗了没」只算一件事:松手那刻光标离主窗多远。
// 贴着窗沿擦出去不算数(手滑)—— 必须超出沿口一小段才算真想放它出去。
// 纯函数不碰 electron,自测脚本拖得进来秒跑。

/** 沿口缓冲带:松手点离主窗最近一条边超过这么多像素,才算「拖出去了」 */
export const DETACH_MARGIN_PX = 10

/** 松手点算不算「在主窗外一段距离」。
 * bounds = 主窗屏幕矩形;x/y = 松手时光标屏幕坐标;margin = 沿口缓冲带。
 * 点在窗内 = false;点在窗外但贴着沿(离最近边 ≤ margin) = false;
 * 任意一个方向超出 margin = true(斜对角出角也行,横竖任一超界即算)。 */
export function isOutsideBounds(
  bounds: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
  margin: number
): boolean {
  const dx = Math.max(bounds.x - x, x - (bounds.x + bounds.width), 0)
  const dy = Math.max(bounds.y - y, y - (bounds.y + bounds.height), 0)
  return dx > margin || dy > margin
}
