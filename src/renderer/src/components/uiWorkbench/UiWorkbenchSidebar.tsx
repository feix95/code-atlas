// UI 工作台的左侧栏(对照 Figma 左侧栏):UI 工作台签激活时占用全局侧栏,文件树保活藏着。
// 顶部标题行沿用设置模式的侧栏标题样式;正文后续放图层、组件、变量、AI 对话。
import { RegionHint } from './RegionHint'

export function UiWorkbenchSidebar(): React.JSX.Element {
  return (
    <>
      <div className="sidebar-top cfg-snav-head">
        <span className="cfg-snav-title">UI 工作台</span>
      </div>
      <div className="uwb-side-body" role="region" aria-label="UI 工作台左侧栏">
        <RegionHint region="sidebar" />
      </div>
    </>
  )
}
