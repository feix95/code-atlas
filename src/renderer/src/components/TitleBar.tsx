// 自绘标题栏:整条区域负责拖动窗口,右上角三颗圆点是真按钮,顺序照 Windows 习惯
// (从左到右:最小化 → 最大化/还原 → 关闭)。关闭是危险动作,单独偏红;
// 另外两颗保持中性灰,不做红黄绿信号灯。悬停反馈必须留 —— 不 hover 就分不清能不能点
export function TitleBar(): React.JSX.Element {
  return (
    <div className="titlebar">
      <span className="titlebar-text">CodeAtlas · AI 代码地图</span>
      <div className="traffic-lights">
        <button type="button" className="light is-min" title="最小化" aria-label="最小化窗口" onClick={() => void window.atlas.windowMinimize()}>
          <i aria-hidden="true" />
        </button>
        <button
          type="button"
          className="light is-max"
          title="最大化 / 还原"
          aria-label="最大化或还原窗口"
          onClick={() => void window.atlas.windowMaximizeToggle()}
        >
          <i aria-hidden="true" />
        </button>
        <button type="button" className="light is-close" title="关闭" aria-label="关闭窗口" onClick={() => void window.atlas.windowClose()}>
          <i aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
