// 模型状态去重(纯函数,自测覆盖)
// 「卡上现在显示的」和「刚算出来的」是不是同一份 —— 字段漏比会让能力变化
// (比如视觉标签)静默推不到界面。vision 缺省与 'unknown' 同义,按一档算。

import type { ModelStatus } from './types.ts'

export function sameModelStatus(a: ModelStatus | null, b: ModelStatus): boolean {
  return (
    a !== null &&
    a.provider === b.provider &&
    a.state === b.state &&
    a.modelName === b.modelName &&
    a.message === b.message &&
    (a.vision ?? 'unknown') === (b.vision ?? 'unknown')
  )
}
