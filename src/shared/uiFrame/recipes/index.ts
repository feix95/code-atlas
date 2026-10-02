// 组件配方注册表:全部组件在此集中登记(§7.1)。
// 组件 CSS、演示 CSS、演示页、README 组件总表、体检的状态与属性检查都由本表驱动;
// 新增组件 = 在此数组里加一份配方,其余环节自动跟上。
import type { ComponentRecipe } from './types.ts'
import { BUTTON } from './button.ts'
import { ICON_BUTTON } from './iconButton.ts'
import { CARD } from './card.ts'
import { SWITCH } from './switchComp.ts'
import { CHECKBOX } from './checkbox.ts'
import { INPUT } from './input.ts'
import { TABS } from './tabs.ts'
import { LIST_ROW } from './listRow.ts'
import { TOOLTIP } from './tooltip.ts'

export const RECIPES: ComponentRecipe[] = [
  BUTTON,
  ICON_BUTTON,
  SWITCH,
  CHECKBOX,
  INPUT,
  TABS,
  CARD,
  LIST_ROW,
  TOOLTIP
]
