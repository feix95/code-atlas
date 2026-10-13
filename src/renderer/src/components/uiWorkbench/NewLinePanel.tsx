// 属性面板 · 直线工具选中且画布无选中时:编辑「新直线默认外观」(颜色/线宽/线型/端点样式),
// 之后画出的直线以此为初始外观;复用 LinePanel,数据源换成 newLineDefaultsStore。
import { newLineDefaultsActions, useNewLineDefaults } from '../../uiWorkbench/newLineDefaultsStore'
import { LinePanel } from './LinePanel'

export function NewLinePanel(): React.JSX.Element {
  const defaults = useNewLineDefaults()
  return <LinePanel node={defaults} onPatch={newLineDefaultsActions.patch} isDefaults />
}
