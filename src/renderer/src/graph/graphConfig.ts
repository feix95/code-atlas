// 关系图谱的集中配置:力参数、节点尺寸、视口缩放、标签淡出、动画时长。
// 调手感只改这里;颜色不在此处,走 graph.css 的 --graph-* token(跟随亮暗主题)。

export const GRAPH_FORCE = {
  /** 节点间斥力(负值 = 互斥) */
  charge: -280,
  /** 斥力作用上限距离,超出不再计算(世界坐标) */
  chargeMaxDistance: 900,
  /** 引用边的目标长度 */
  linkDistance: 80,
  /** 引用边弹性 */
  linkStrength: 0.4,
  /** 向画布原点的牵引力:孤立节点靠它不飘走 */
  gravity: 0.035,
  /** 碰撞半径在节点半径之外追加的间隙 */
  collidePadding: 6,
  /** 每帧速度衰减(越大越"黏") */
  velocityDecay: 0.35,
  /** 拖拽节点时模拟保持的热度 */
  dragAlphaTarget: 0.3,
  /** 新节点出生时离原点的最大随机偏移 */
  spawnJitter: 40
} as const

export const GRAPH_NODE = {
  fileRadiusMin: 5,
  fileRadiusMax: 16,
  /** 文件半径 = min + sqrt(度数) × step */
  fileRadiusStep: 1.6,
  folderRadiusMin: 6,
  folderRadiusMax: 20,
  /** 文件夹半径 = min + sqrt(后代文件数) × step */
  folderRadiusStep: 1.2,
  externalRadius: 5,
  overflowRadius: 8,
  /** 命中检测在半径外放宽的像素(屏幕坐标) */
  hitSlopPx: 4,
  /** 空心节点(外部 / 未扫描 / 其余)的描边宽度 */
  ringWidth: 1.5
} as const

export const GRAPH_EDGE = {
  width: 0.8,
  /** 归并边线宽 = width + log2(条数) × weightStep */
  weightStep: 0.5,
  arrowLength: 5,
  arrowWidth: 3.5
} as const

export const GRAPH_VIEW = {
  minScale: 0.2,
  maxScale: 4,
  /** 滚轮缩放灵敏度:factor = exp(-deltaY × wheelSpeed) */
  wheelSpeed: 0.0015,
  /** 按下后移动超过该像素才算拖拽,否则算单击 */
  clickSlopPx: 4,
  /** 「适应画布」四周留白(屏幕像素) */
  fitPaddingPx: 48,
  /** 首次布局稳定(alpha 低于此值)时若节点超出视口,自动适应一次 */
  autoFitAlpha: 0.05
} as const

export const GRAPH_LABEL = {
  /** 缩放比例低于 fadeOut 时标签完全隐藏,高于 fadeIn 时完全显示,之间线性过渡 */
  fadeOutScale: 0.55,
  fadeInScale: 0.95,
  /** 标签与节点底边的间距(世界坐标) */
  gap: 4,
  /** 标签最长字符数,超出截断加省略号 */
  maxChars: 28
} as const

export const GRAPH_MOTION = {
  /** 悬停高亮 / 取消的过渡时长(ms) */
  hoverMs: 150,
  /** 悬停时非相关节点与边的不透明度 */
  dimAlpha: 0.15,
  /** 切换层级:旧层淡出时长(ms) */
  levelOutMs: 150,
  /** 切换层级:新层淡入时长(ms) */
  levelInMs: 300
} as const
