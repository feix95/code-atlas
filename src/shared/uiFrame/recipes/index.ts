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
import { RADIO } from './radio.ts'
import { SEGMENTED } from './segmented.ts'
import { SLIDER } from './slider.ts'
import { SELECT } from './selectComp.ts'
import { STEPPER } from './stepper.ts'
import { RATING } from './rating.ts'
import { TEXTAREA } from './textarea.ts'
import { SEARCH } from './searchBox.ts'
import { BUTTON_GROUP } from './buttonGroup.ts'
import { LINK } from './link.ts'
import { BADGE, BANNER, EMPTY, PROGRESS, SKELETON, SPINNER, TOAST } from './feedback.ts'
import { AVATAR, DIVIDER, TAG } from './dataDisplay.ts'
import {
  APPBAR,
  BOTTOMBAR,
  BREADCRUMB,
  FAB,
  PAGINATION,
  RAIL,
  SIDEBAR,
  STEPS
} from './navigation.ts'
import { ACTION_SHEET, DIALOG, DRAWER, MENU, POPOVER, SHEET } from './overlays.ts'
import { COLLAPSE, TABLE, TIMELINE, TREE } from './containers.ts'
import { PHONE_NAVBAR, PULL_REFRESH, SPLITTER, STATUSBAR, SWIPE_ROW, TITLEBAR } from './platform.ts'

export const RECIPES: ComponentRecipe[] = [
  BUTTON,
  ICON_BUTTON,
  SWITCH,
  CHECKBOX,
  INPUT,
  TABS,
  CARD,
  LIST_ROW,
  TOOLTIP,
  RADIO,
  SEGMENTED,
  SLIDER,
  SELECT,
  STEPPER,
  RATING,
  TEXTAREA,
  SEARCH,
  BUTTON_GROUP,
  LINK,
  TOAST,
  BANNER,
  PROGRESS,
  SPINNER,
  SKELETON,
  EMPTY,
  BADGE,
  TAG,
  AVATAR,
  DIVIDER,
  APPBAR,
  SIDEBAR,
  RAIL,
  BOTTOMBAR,
  BREADCRUMB,
  PAGINATION,
  STEPS,
  FAB,
  MENU,
  POPOVER,
  DIALOG,
  DRAWER,
  SHEET,
  ACTION_SHEET,
  COLLAPSE,
  TABLE,
  TREE,
  TIMELINE,
  TITLEBAR,
  STATUSBAR,
  SPLITTER,
  PHONE_NAVBAR,
  SWIPE_ROW,
  PULL_REFRESH
]
