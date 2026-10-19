/**
 * 徽章:实体名旁边的小色标(蓝/绿/琥珀/红/灰)。
 * 从 DetailHeader 拆出来独立成件 —— 概览页整体退役后,自由对话气泡仍在用它。
 */
export type BadgeTone = 'blue' | 'green' | 'amber' | 'red' | 'muted'

export function Badge({ label, tone }: { label: string; tone: BadgeTone }): React.JSX.Element {
  return <span className={`badge badge-${tone}`}>{label}</span>
}
