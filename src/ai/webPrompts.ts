// 联网查证的问题端:挑搜索词、把程序真做过的动作收敛成状态表 —— 全是纯函数,不发请求。
import type { ChatContextAttachment, WebLookupMeta } from '../shared/types.ts'

/**
 * 联网查询用哪个词去查:优先拿选中对象的名字(只是名字,绝不发路径);
 * 没选中东西时,把问题里的联网意图词剥掉,剩下的当查询词(封顶 60 字防垃圾长串)。
 */
export function pickWebLookupQuery(
  question: string,
  attachment: ChatContextAttachment | null
): string {
  const name = attachment && attachment.targetType !== 'none' ? attachment.name.trim() : ''
  if (name) return name
  return question
    .replace(/联网|搜索|搜搜|搜一下|查查|查一下|上网|网上|百度|谷歌|帮我|search/gi, ' ')
    .replace(/[\s,。?!?!、·::""'']+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
}

/**
 * 把程序真实执行过的联网动作收敛成状态状态表:
 * material = null 表示查询本身失败(网络/超时);'' 表示查完了但没有可用资料;
 * 有内容才是 completed,并把命中的来源记进去。模型的自述不参与记账。
 */
export function resolveWebLookupMeta(
  requested: boolean,
  enabled: boolean,
  outcome:
    | { kind: 'skipped' }
    | { kind: 'attempted'; material: string; sources: string[] }
    | { kind: 'error' }
): WebLookupMeta {
  if (!requested)
    return { requested: false, enabled, attempted: false, state: 'not_requested', sources: [] }
  if (!enabled)
    return { requested: true, enabled: false, attempted: false, state: 'disabled', sources: [] }
  if (outcome.kind === 'skipped')
    return { requested: true, enabled: true, attempted: false, state: 'failed', sources: [] }
  if (outcome.kind === 'error')
    return { requested: true, enabled: true, attempted: true, state: 'failed', sources: [] }
  if (outcome.material === '')
    return { requested: true, enabled: true, attempted: true, state: 'empty', sources: [] }
  return {
    requested: true,
    enabled: true,
    attempted: true,
    state: 'completed',
    sources: outcome.sources
  }
}

/**
 * 追问里有没有点名叫联网/搜索:这类词命中且开关开着,才把联网资料塞进这一轮。
 * 词表放得宽(搜搜/查一下/网上都算),误触发顶多多查一次,不伤功能。
 */
export function hasSearchIntent(question: string): boolean {
  return /联网|搜索|搜搜|搜一下|查查|查一下|上网|网上|百度|谷歌|search/i.test(question)
}
