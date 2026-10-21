/** 翻译切块入口:主进程送模型与渲染层对照稿共用,禁止各写一套。 */
import { splitMdBlocks, type MdBlockSlice } from './mdBlocks.ts'
import { splitDocBlocks } from './plainBlocks.ts'
import { translateFamilyOf } from './translateGate.ts'

export function splitTranslateBlocks(text: string, relPath: string): MdBlockSlice[] {
  const family = translateFamilyOf(relPath)
  if (family === 'plaintext' || family === 'markup') return splitDocBlocks(text)
  return splitMdBlocks(text)
}
