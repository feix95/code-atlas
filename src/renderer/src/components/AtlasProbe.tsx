/**
 * Atlas 小探针:纯展示的 Q 版小机器人(圆形脑袋 + 两只眼睛 + 挂钟摆的天线),
 * CSS + inline SVG 手搓,不引外部图片。只负责把状态演出来,不发请求、不管业务。
 * 状态:idle 待命(呼吸+慢摆)/ thinking 思考中(摆快+浮动+眼睛左右看)/ error 这轮没完成(变琥珀色)。
 * 动画全在 CSS;系统开了"减少动态效果"就静止,只靠 aria-label 和文字传达状态。
 */
export type ProbeState = 'idle' | 'thinking' | 'error'

const STATE_LABEL: Record<ProbeState, string> = {
  idle: 'Atlas 小探针:待命',
  thinking: 'Atlas 小探针正在思考',
  error: 'Atlas 小探针:这次没完成'
}

export function AtlasProbe({ state, className }: { state: ProbeState; className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 48 48"
      className={`atlas-probe is-${state}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={STATE_LABEL[state]}
    >
      <g className="probe-antenna">
        <line x1="24" y1="15" x2="24" y2="8" />
        <circle className="probe-bell" cx="24" cy="6" r="2.8" />
      </g>
      <g className="probe-head">
        <rect className="probe-shell" x="9" y="15" width="30" height="24" rx="12" />
        <circle className="probe-eye" cx="19" cy="27" r="2.5" />
        <circle className="probe-eye" cx="29" cy="27" r="2.5" />
      </g>
    </svg>
  )
}
