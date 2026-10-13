// UI 工作台的左侧栏(对照 Figma 左侧栏):UI 工作台签激活时占用全局侧栏,文件树保活藏着。
// 顶部标题行沿用设置模式的侧栏标题样式;正文放样式组,后续再放图层、变量、AI 对话。
import { GroupsPanel } from './GroupsPanel'

export function UiWorkbenchSidebar(): React.JSX.Element {
  return (
    <>
      <div className="sidebar-top cfg-snav-head">
        <span className="cfg-snav-title">UI 工作台</span>
      </div>
      <div className="uwb-side-body" role="region" aria-label="UI 工作台左侧栏">
        <GroupsPanel />
      </div>
    </>
  )
}
