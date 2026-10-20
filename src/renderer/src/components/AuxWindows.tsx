// 独立子窗的门房(页签独立窗口,纯迁移自 App):每扇子窗一份壳
// (标题栏+页签带+分屏正文),Portal 渲染进子窗 document ——
// 同一棵 React 树,活的签的页签活 DOM整体迁移;登记过滤(groupsForHost)收在这层。
import { createPortal } from 'react-dom'
import { groupsForHost, type PaneGroup } from '../paneTabs'
import type { AuxWindowHandle } from '../useAuxWindows'
import { AuxWindowShell, type TabAreaProps } from './AuxWindowShell'

export function AuxWindows({
  auxWins,
  groups,
  tabArea,
  onRequestClose
}: {
  auxWins: AuxWindowHandle[]
  groups: PaneGroup[]
  tabArea: TabAreaProps
  /** 子窗请求关窗(空壳即死/点窗控 ×):App 侧收 closeAuxWindow */
  onRequestClose: (id: string) => void
}): React.JSX.Element[] {
  return auxWins.map((a) =>
    createPortal(
      <AuxWindowShell
        key={a.id}
        aux={a}
        groups={groupsForHost(groups, a.id)}
        tabArea={tabArea}
        onRequestClose={() => onRequestClose(a.id)}
      />,
      a.container
    )
  )
}
