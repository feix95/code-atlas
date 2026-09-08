// 同话降噪:同一目录里一模一样的话,从第二条起只亮 emoji,鼠标悬停看全文。
// 风险句(sticky)豁免 —— "不要手动改"这类话重复出现是故意的,要形成条件反射(第九十二锤定稿规则)。
import type { ScanTreeNode } from './types.ts'

/**
 * 判定一组兄弟节点里,哪些行的摘要该只亮 emoji。
 * 返回与 children 等长的布尔数组,true = 只显示 emoji;没有摘要或风险句恒为 false。
 */
export function flagDuplicateSummaries(children: ScanTreeNode[]): boolean[] {
  const seen = new Set<string>()
  return children.map((child) => {
    const text = child.summary?.text
    if (text === undefined) return false
    const sticky = child.summary?.sticky === true
    const dup = !sticky && seen.has(text)
    if (!sticky) seen.add(text)
    return dup
  })
}
