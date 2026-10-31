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
  /** 焦点层无引用节点额外的向心引力:只靠全局重力时会被中心斥力推到电荷上限附近,散在外圈 */
  orphanGravity: 0.3,
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
  /** 打开或切换层级时首帧之前同步预跑到热度低于此值:首帧即最终布局,落视口的比例不再随后变化 */
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
  /** 选中节点(详情浮窗所指)的外圈:描边宽度与离节点边缘的间隙(世界坐标) */
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
  fitMaxScale: 1.5
} as const

/** 层级:原地展开的容器几何与「展开两级」的深度 */
export const GRAPH_ZOOM = {
  /** 「展开两级」最多到焦点下几级;更深层靠双击展开或进入文件夹 */
  autoExpandDepth: 2,
  /** 容器半径 = sqrt(Σ(子半径 + containerPadding)²) × packFactor */
  packFactor: 1.15,
  /** 容器内边距:子节点半径之外再留的世界坐标距离 */
  containerPadding: 8,
  /** 约束子项时在容器边缘之外再留的安全边距;切向速度积分后的微小外溢靠它兜住 */
  containMargin: 1
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

/** 原地展开的容器:半透明圆底 + 顶边内侧的名称 */
export const GRAPH_CONTAINER = {
  /** 容器描边宽度(世界坐标) */
  strokeWidth: 1.2,
  /** 名称离容器顶边内侧的距离(世界坐标) */
  labelGap: 8
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

/** 第 GRAPH_MODULE_COLORS+1 个模块起的生成色:色相从 hueStart 起按黄金角步进,明暗两档交替(见 moduleColors.ts) */
export const GRAPH_MODULE_GEN = {
  hueStart: 18,
  hueStep: 137.508
} as const

/** 悬停提示框 */
export const GRAPH_TIP = {
  /** 悬停多久才亮(ms):鼠标扫过节点时不闪 */
  delayMs: 300,
  /** 气泡与节点边缘的间距(屏幕像素) */
  gapPx: 10,
  /** 气泡离画布边缘的最小距离(屏幕像素) */
  edgePx: 8
} as const

/** 滚轮手势(见 wheelIntent.ts) */
export const GRAPH_WHEEL = {
  /** 鼠标在节点上停够这么久(ms),滚轮才切看法;刚划过节点就滚轮仍是缩放 */
  restMs: 300,
  /** 两个滚轮事件间隔小于此值(ms)算同一个手势,整个手势保持开头的动作 */
  gestureGapMs: 200,
  /** 切看法:每累计这么多像素走一步(鼠标滚轮一格约 100px) */
  modeStepPx: 100,
  /** 层级:累计这么多像素走一步,一个手势最多一步 */
  levelStepPx: 40
} as const
