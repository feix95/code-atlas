/**
 * 输入舱弹性长高的公共口径(P2-11):主窗(FreeChatPanel)和气泡窗(BubblePage)
 * 同一个交互一本账 —— 自动长高到 CAP 行封顶,封顶后浮拨杆,拨上去固定 EXPAND 行。
 * 行高兜底不是共享口径:两窗的 textarea 字号不同,各量各的(主窗 24 / 气泡 20,
 * 后者和 bubble.css 的 line-height:20px 是一口约定)。
 */
export const INPUT_CAP_LINES = 5
export const INPUT_EXPAND_LINES = 10
/** 拨杆(展开/收合)那颗小箭头的尺寸:两窗同款岗,同一本账 */
export const INPUT_TOGGLE_ICON_SIZE = 12
