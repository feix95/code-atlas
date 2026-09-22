// ── 分析用料的上限 ──
// 「多大的文件还值得解析」只有一杆秤:depgraph 全仓解析、analyze-file 单文件解析、
// 文件解释时的结构流,三处同一条线 —— 调阈值只许动这里。

/** 源码解析的文件大小上限(字节):超过就不喂 tree-sitter,避免卡顿 */
export const SOURCE_PARSE_MAX_BYTES = 1_000_000
