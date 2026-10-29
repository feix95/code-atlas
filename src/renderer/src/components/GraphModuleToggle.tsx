// 关系图谱工具栏的「模块着色」开关
export function ModuleToggle({
  isOn,
  onToggle
}: {
  isOn: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="graph-toggle"
      aria-pressed={isOn}
      onClick={onToggle}
      data-tip={isOn ? '关闭后只看原始文件夹结构' : '在图上圈出程序划分的模块'}
    >
      <span className="graph-toggle-dot" aria-hidden="true" />
      模块着色
    </button>
  )
}
