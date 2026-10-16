// UI 工作台的左侧栏(对照 Figma File 页):UI 工作台签激活时占用全局侧栏,文件树保活藏着。
// 顶部标题行沿用设置模式的侧栏标题样式;正文自上而下:页面、图层(吃剩余高度)、样式组(Assets 位)。
// 应用级配置(AI、外观)不放这里,留在设置页;选中对象的属性在右侧面板。
import { GroupsPanel } from './GroupsPanel'
import { LayersPanel } from './LayersPanel'
import { PagesPanel } from './PagesPanel'

export function UiWorkbenchSidebar(): React.JSX.Element {
  return (
    <>
      <div className="sidebar-top cfg-snav-head">
        <span className="cfg-snav-title">UI 工作台</span>
      </div>
      <div className="uwb-side-body" role="region" aria-label="UI 工作台左侧栏">
        <PagesPanel />
        <LayersPanel />
        <GroupsPanel />
      </div>
    </>
  )
}
