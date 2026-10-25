/**
 * 输入舱弹性长高的公共口径(P2-11):自动长高到 CAP 行封顶,
 * 封顶后浮拨杆,拨上去固定 EXPAND 行。
 */
import { ROOT_FONT_BASE_PX } from '@shared/uiScale'

export const INPUT_CAP_LINES = 5
export const INPUT_EXPAND_LINES = 10
/** 拨杆(展开/收合)那颗小箭头的尺寸:两窗同款岗,同同一数据源 */
export const INPUT_TOGGLE_ICON_SIZE = 12

/** 输入栏右侧三颗圆钮(思考/翻文件/发送)图标旋钮:共享一个大小,跟别处分组互不相关 */
export const CHAT_ACTION_ICON_SIZE = 16
/** 消息行内小动作钮(复制/重试)的图标尺寸 */
export const MSG_ACTION_ICON_SIZE = 13
/** 聊天内嵌小图标(附件回形针/代码引用芯片这类跟着文字走的) */
export const INLINE_ICON_SIZE = 12
/** 右键菜单行内图标的尺寸(通用 ContextMenu 一档):比行字略大、不占行高 */
export const MENU_ICON_SIZE = 14
/** 纯图标菜单的图标尺寸(对照视觉参考 icon-only;线宽走 TreeIcon 默认 2) */
export const MENU_ICON_ONLY_SIZE = 17

/** 窗控三键(最小化/最大化/关窗)的图标尺寸:主窗和独立子窗同一颗钮,同同一数据源 */
export const WIN_ICON_SIZE = 18
/** rail 列图标本体:1.6rem,与 tokens.css --icon-rail 同值 */
export const RAIL_ICON_SIZE = 1.6 * ROOT_FONT_BASE_PX
