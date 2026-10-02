// 出处核对的纯比对逻辑(§14 防编造):主进程读到文件文本后在这里判定,
// 渲染层与自测共用同一把尺。判定四态见 ProvenanceVerdict.status。
import type { ProvenanceVerdict } from './types.ts'

/** 去空白/引号/分号/尾逗号并转小写,颜色与数值文本同尺比较 */
export function normLit(s: string): string {
  return s
    .replace(/[\s'";]/g, '')
    .toLowerCase()
    .replace(/,$/, '')
}

/** 文件文本 × 声明(行号+期望字面值)→ 核对结论 */
export function verifyClaim(
  name: string,
  file: string,
  line: number,
  expect: string,
  text: string | null
): ProvenanceVerdict {
  if (text === null) {
    return { name, file, line, status: 'nofile', detail: '文件找不到或路径越界' }
  }
  const lines = text.split(/\r?\n/)
  const want = normLit(expect)
  const cited = line > 0 && line <= lines.length ? lines[line - 1]! : ''
  if (want && normLit(cited).includes(want)) {
    return { name, file, line, status: 'matched', detail: '已核对' }
  }
  const hitLine = lines.findIndex((l) => want && normLit(l).includes(want))
  if (hitLine >= 0) {
    return { name, file, line, status: 'line-off', detail: `值在文件里,但在第 ${hitLine + 1} 行` }
  }
  return { name, file, line, status: 'mismatch', detail: '出处里没找到这个值' }
}
