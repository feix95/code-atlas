// 输入舱的弹性长高账:空=一行,写到几行长几行,五5行封顶;拨杆拨上去多撑五行。
import { useEffect, useRef, useState } from 'react'
import { INPUT_CAP_LINES, INPUT_EXPAND_LINES } from './inputMetrics'

/**
 * 弹性长高的账(产品指定):空 = 一行;有一到四行长到几行;五行封顶,
 * 拨杆拨上去多给五行(共十行),超出的舱内自己滚;文字退回五行内拨杆自动归位。
 * 防抖(小葵报的病):文字卡在换行临界点时,打一个字涨两行、删一个字缩一行,舱来回蹦。
 * 治法是「涨快缩慢」:涨按实际行数,缩要富余 —— 量行宽时右侧多留一截,
 * 文字连这一截都省出来才准缩回一行。另外单行/多行两种布局的行宽不一样
 * (单行舱文字让着按钮排,多行舱铺满),量行数时给多行舱补上按钮排的地盘,
 * 两种布局按同一个尺度量,免得「多行里量着放得下、缩回单行立刻又放不下」来回打架。
 */
const BAR_RESERVE = '13rem' // 单行舱右侧按钮排的地盘(俩图标胶囊+发送钮,忙时还有「取消」,往宽了备)
const COLLAPSE_SLACK = '4rem' // 缩回一行的富余:比按钮排还宽出这么多才缩

export function useComposerAutosize(
  draft: string,
  expanded: boolean,
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>
): {
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  lineCount: number
  capped: boolean
} {
  const [lineCount, setLineCount] = useState(1)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const cs = getComputedStyle(el)
    const line = Number.parseFloat(cs.lineHeight) || 24
    // border-box 账:style.height 写的是含内边距的总高 —— 漏加 padding 的话
    // 文字盒被 padding 吃掉一截,overflow:hidden 上下裁字(界面放得越大裁得越狠)
    const padY = Number.parseFloat(cs.paddingTop) + Number.parseFloat(cs.paddingBottom)
    const multi = lineCount >= 2
    el.style.height = 'auto'
    // 统一适配估算:多行舱里临时把右侧按按钮排地盘收窄,量出来的行数和单行舱一个尺度
    el.style.paddingRight = multi ? BAR_RESERVE : ''
    const realLines = Math.max(1, Math.round(el.scrollHeight / line))
    // 收缩判定:在统一适配估算上再加一截富余,连富余都省出来还是一行,才真缩
    el.style.paddingRight = multi ? `calc(${BAR_RESERVE} + ${COLLAPSE_SLACK})` : COLLAPSE_SLACK
    const slackLines = Math.max(1, Math.round(el.scrollHeight / line))
    el.style.paddingRight = ''
    const shown = realLines >= 2 ? realLines : slackLines >= 2 ? 2 : 1
    // 十行锁死(产品指定):展开就是十行高,内容超了右侧滚条翻看,舱绝不跟着内容再长
    el.style.height = `${
      (expanded ? INPUT_EXPAND_LINES * line : Math.min(shown * line, INPUT_CAP_LINES * line)) + padY
    }px`
    setLineCount(shown)
    if (expanded && realLines < INPUT_CAP_LINES) setExpanded(false)
  }, [draft, expanded, lineCount, setExpanded])

  const capped = lineCount >= INPUT_CAP_LINES || expanded
  return { inputRef, lineCount, capped }
}
