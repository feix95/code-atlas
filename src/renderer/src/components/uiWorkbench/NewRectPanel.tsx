// 属性面板 · 矩形工具选中且画布无选中时:编辑「新矩形默认外观」(样式/圆角/填充/描边),
// 之后画出的矩形以此为初始外观;复用 RectPanel,数据源换成 newRectDefaultsStore。
import { newRectDefaultsActions, useNewRectDefaults } from '../../uiWorkbench/newRectDefaultsStore'
import { RectPanel } from './RectPanel'

export function NewRectPanel(): React.JSX.Element {
  const defaults = useNewRectDefaults()
  return <RectPanel node={defaults} onPatch={newRectDefaultsActions.patch} isDefaults />
}
