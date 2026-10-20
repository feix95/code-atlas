/** 原文 / 译文对照的悬停联动:谁被指着,两块同号内容一起亮。
 *
 * 链接按「读根 + relPath」记账:同一份文件可以同时开几个语种镜像,全跟着亮。
 * 只在有镜像页签挂着时生效;镜像全关了,原文照旧是普通阅读页。
 */

const linked = new Map<string, number>()
let hovered: { key: string; block: number } | null = null
const listeners = new Set<() => void>()

export function mdFileKey(rootPath: string, relPath: string): string {
  return `${rootPath}|${relPath}`
}

function emit(): void {
  for (const l of listeners) l()
}

export function subscribeMdHover(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 一份原文被几张镜像签指着;最后一张关掉才算解链 */
export function linkMdFile(key: string): void {
  linked.set(key, (linked.get(key) ?? 0) + 1)
  emit()
}

export function unlinkMdFile(key: string): void {
  const next = (linked.get(key) ?? 0) - 1
  if (next > 0) linked.set(key, next)
  else {
    linked.delete(key)
    if (hovered?.key === key) hovered = null
  }
  emit()
}

export function isMdLinked(key: string): boolean {
  return (linked.get(key) ?? 0) > 0
}

export function setHoveredBlock(key: string, block: number | null): void {
  if (block === null) {
    if (hovered?.key !== key) return
    hovered = null
  } else {
    if (hovered?.key === key && hovered.block === block) return
    hovered = { key, block }
  }
  emit()
}

export function hoveredBlockOf(key: string): number | null {
  return hovered?.key === key ? hovered.block : null
}
