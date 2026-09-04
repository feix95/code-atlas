import type { ReactNode } from 'react'

/**
 * 信号灯三级信息条,全项目共用一份口径:
 * info = 随口一说(灰) · warn = 留个心眼(琥珀) · error = 真出事了(红)
 * 红色只许 error 用 —— 满屏狼来了,真出事就没人信了
 */
export function Notice({ kind, children }: { kind: 'info' | 'warn' | 'error'; children: ReactNode }): React.JSX.Element {
  return <div className={`notice${kind === 'info' ? '' : ` notice-${kind}`}`}>{children}</div>
}
