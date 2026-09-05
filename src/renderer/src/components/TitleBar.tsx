// 自绘标题栏:整条区域负责拖动窗口,左上角三颗灰点是真按钮(关 / 最小化 / 最大化切换)。
// 长相照参考图 —— 纯灰点、不画红黄绿;所以悬停必须有反馈,不然看不出能不能点
export function TitleBar(): React.JSX.Element {
  return (
    <div className="titlebar">
      <div className="traffic-lights">
        <button type="button" className="light" title="关闭" aria-label="关闭窗口" onClick={() => void window.atlas.windowClose()} />
        <button type="button" className="light" title="最小化" aria-label="最小化窗口" onClick={() => void window.atlas.windowMinimize()} />
        <button
          type="button"
          className="light"
          title="最大化 / 还原"
          aria-label="最大化或还原窗口"
          onClick={() => void window.atlas.windowMaximizeToggle()}
        />
      </div>
      <span className="titlebar-text">CodeAtlas · AI 代码地图</span>
    </div>
  )
}
