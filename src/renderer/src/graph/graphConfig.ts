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
  spawnJitter: 40,
  /** 聚类力:同模块可见节点被拉向该模块可见成员质心的强度(关闭「模块着色」时为 0) */
  clusterStrength: 0.08,
  /** 打开或切换层级时首帧之前同步预跑到热度低于此值(须低于 GRAPH_VIEW.autoFitAlpha,首帧即可适应画布) */
  settleAlpha: 0.02,
  /** 同步预跑的步数上限(单层最多 150 个节点,约几十毫秒) */
  settleMaxTicks: 400
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
  ringWidth: 1.5,
  /** 单击选中节点的外圈:描边宽度与离节点边缘的间隙(世界坐标) */
  selectedWidth: 2,
  selectedGap: 7
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
  /** 「适应画布」最多放大到的比例:三两个节点的小层级不会被放得巨大 */
  fitMaxScale: 1.5,
  /** 新层级布局稳定(alpha 低于此值,预跑后首帧即满足)时、绘制之前自动适应一次:节点超出视口,或适应后能放大到当前比例的这么多倍 */
  autoFitAlpha: 0.05,
  autoFitGrowRatio: 1.25
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

/** 模块轮廓(划分):只贴着本模块成员走,成员间细连桥相连,非成员节点处挖开 */
export const GRAPH_HULL = {
  /** 轮廓在成员节点半径外追加的留白(世界坐标) */
  padding: 14,
  /** 成员之间连桥的半宽(世界坐标);小于 padding,连桥比成员处细 */
  bridgeWidth: 8,
  /** 非成员节点在半径外再让出的距离(世界坐标);小于碰撞间隙的两倍,不会挖到成员本身 */
  obstacleGap: 6,
  /** 求轮廓的网格边长(世界坐标);越小越贴合、越费算力 */
  cell: 6,
  /** 未展开的文件夹:后代文件中某模块占比不低于此值时,计入该模块轮廓 */
  folderDominantShare: 0.6,
  /** 轮廓描边宽度(世界坐标) */
  strokeWidth: 1,
  /** 模块名标签在轮廓顶边之上的间距(世界坐标) */
  labelGap: 4
} as const

/** 文件夹节点外圈的分段色环 */
export const GRAPH_RING = {
  /** 最多段数;超出的模块合并成中性色一段 */
  maxSegments: 6,
  /** 环宽(世界坐标) */
  width: 3,
  /** 环与节点边缘的间隙(世界坐标) */
  gap: 2,
  /** 相邻两段之间留的缝(弧度) */
  segmentGap: 0.06
} as const

/** 模块调色板的色数:与 graph.css 的 --graph-module-1 至 --graph-module-N 对应 */
export const GRAPH_MODULE_COLORS = 8
