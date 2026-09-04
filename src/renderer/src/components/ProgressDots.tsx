// 统一等待语言:三个脉冲点(装饰,读屏不念),后面跟「谁在干什么」的动词文案
export function ProgressDots(): React.JSX.Element {
  return (
    <span className="progress-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}
