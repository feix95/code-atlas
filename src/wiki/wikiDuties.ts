// 文件职责填句(C5):职责表由程序列行,模型一次调用逐文件填一句话职责;
// 证据是全段摘要合并加导出符号作用,不许只看文件首段;填句失败走程序兜底。
import type { WikiCompleter, WikiPageEvidence, WikiSegmentNote } from './wikiReadTypes.ts'

function dutyFallback(path: string, evidence: WikiPageEvidence, notes: WikiSegmentNote[]): string {
  const file = evidence.files.find((f) => f.path === path)
  if (!file) return '本页成员文件'
  if (file.dataFacts && file.dataFacts.length > 0) return file.dataFacts[0]!
  const names = [...new Set(file.symbolRanges.map((r) => r.name))].slice(0, 4)
  void notes
  return names.length > 0 ? `包含 ${names.join('、')} 等符号` : '本页成员文件'
}

/** 一次调用填完全页文件的一句话职责(C5:按文件加页面类型缓存的口径,原型先整页一批) */
export async function fillDuties(
  evidence: WikiPageEvidence,
  notes: WikiSegmentNote[],
  complete: WikiCompleter,
  stats: { calls: number }
): Promise<Map<string, string>> {
  const duties = new Map<string, string>()
  const readable = evidence.files.filter((f) => f.tier !== 'list')
  if (readable.length === 0) return duties
  const lines = readable.map((file) => {
    // 全段摘要都要进:只取开头一段会把多段文件的职责写成首段的样子(真机实测教训)
    const summary = notes
      .filter((n) => n.path === file.path)
      .map((n) => n.segmentSummary.slice(0, 70))
      .join('；')
      .slice(0, 800)
    const exportRoles = notes
      .filter((n) => n.path === file.path)
      .flatMap((n) => n.symbolNotes)
      .filter((s) => (file.structure?.exports ?? []).includes(s.name))
      .map((s) => `${s.name}:${s.role}`)
      .join('；')
      .slice(0, 300)
    const facts = file.dataFacts ? file.dataFacts.join(';') : ''
    return `- ${file.path}(角色 ${file.role}):${[summary, exportRoles, facts].filter((s) => s !== '').join(' | ') || '无笔记'}`
  })
  const user = [
    `页面「${evidence.pageTitle}」的文件清单与阅读摘要:`,
    ...lines,
    '为每个文件写一句话职责(不超过 40 字,说清它干什么,不复述文件名)。只输出 JSON:{"duties":[{"path":"文件路径","duty":"一句话职责"}]}'
  ].join('\n')
  stats.calls++
  try {
    const raw = await complete(
      '你是文档作者。只依据给定摘要写作,不使用摘要里不存在的标识符。只输出 JSON,不要输出其他文字。',
      user,
      1200
    )
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        duties?: { path?: unknown; duty?: unknown }[]
      }
      for (const item of parsed.duties ?? []) {
        if (typeof item.path === 'string' && typeof item.duty === 'string') {
          duties.set(item.path, item.duty)
        }
      }
    }
  } catch {
    // 填句失败不阻塞:全部走程序兜底
  }
  for (const file of readable) {
    if (!duties.has(file.path)) duties.set(file.path, dutyFallback(file.path, evidence, notes))
  }
  return duties
}
