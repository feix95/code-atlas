// ── 第八十三锤:后退 / 前进 ──
// 浏览过的「位置」排成一条线:首页、开过的项目、点过的文件/文件夹都算一站。
// 后退/前进按钮就是在这条线上挪游标;中途跳去新的地方,游标身后的「前进」线剪掉(浏览器同款)。
// 纯函数单独搁这儿,自测盯着:去重、剪线、封顶、游标夹边,一个都不许糊涂。

export interface NavLocation {
  /** 项目根;null = 首页(这台电脑) */
  folder: string | null
  /** 选中的文件 relPath;没选文件为 null */
  file: string | null
  /** 选中的文件夹 relPath;没选为 null */
  dir: string | null
}

/** 历史最长记 60 站:够用一下午,又不至于在内存里攒一列火车 */
export const NAV_MAX = 60

/** 两站是否同一个地方(纯函数,自测覆盖):三样都对上才算原地 */
export function sameLocation(a: NavLocation, b: NavLocation): boolean {
  return a.folder === b.folder && a.file === b.file && a.dir === b.dir
}

/** 走到新地方:与当前站相同就不动(连点同一个文件不记第二笔);
 *  否则剪掉游标身后的前进线、站名入栈;超长从最老的开始请出去(纯函数,自测覆盖)
 */
export function pushNavLocation(
  stack: NavLocation[],
  index: number,
  loc: NavLocation
): { stack: NavLocation[]; index: number } {
  const current = stack[index]
  if (current && sameLocation(current, loc)) return { stack, index }
  const kept = stack.slice(0, index + 1)
  kept.push(loc)
  while (kept.length > NAV_MAX) {
    kept.shift()
  }
  return { stack: kept, index: kept.length - 1 }
}

/** 游标挪动:后退 delta 为负、前进为正;到头就不动,绝不滑出线外(纯函数,自测覆盖) */
export function stepNavIndex(index: number, delta: number, length: number): number {
  return Math.min(Math.max(index + delta, 0), Math.max(length - 1, 0))
}
