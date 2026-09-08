// ── 第八十四锤:token 账的显示话术 ──
// 状态栏的「忙」和自由对话气泡下的实时小账,共用同一套说法,免得两张嘴。
// 纯函数:主进程、渲染层、自测三边都能端起来用,不碰任何系统东西。

import type { AiStreamStats, AiUsage } from './types.ts'

const fmt = (n: number): string => n.toLocaleString('en-US')

/** 流式实时账 → 一句话:「读材料中 · 已读 2,048 tokens」/「已吐 128 tokens · 12 tokens/s」 */
export function formatStreamStats(stats: AiStreamStats): string {
  const tps = stats.tokensPerSecond
  const speed = tps !== undefined ? ` · ${tps >= 10 ? Math.round(tps) : tps.toFixed(1)} tokens/s` : ''
  if (stats.phase === 'reading') {
    return stats.promptTokens !== undefined ? `读材料中 · 已读 ${fmt(stats.promptTokens)} tokens` : '读材料中……'
  }
  const out = stats.outputTokens !== undefined ? `已吐 ${fmt(stats.outputTokens)} tokens` : '吐字中'
  return `${out}${speed}`
}

/** 收尾账 → 尾注一句话:「读 2,048 · 吐 128 tokens · 12 tokens/s」;缺哪段省哪段 */
export function formatUsage(usage: AiUsage): string {
  const parts: string[] = []
  if (usage.promptTokens !== undefined) parts.push(`读 ${fmt(usage.promptTokens)}`)
  if (usage.outputTokens !== undefined) parts.push(`吐 ${fmt(usage.outputTokens)}`)
  if (parts.length === 0) return ''
  const tps = usage.tokensPerSecond
  const speed = tps !== undefined ? ` · ${tps >= 10 ? Math.round(tps) : tps.toFixed(1)} tokens/s` : ''
  return `${parts.join(' · ')} tokens${speed}`
}
