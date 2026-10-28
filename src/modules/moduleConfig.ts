// 模块切分参数的唯一来源;调参只改这里,定稿值同步记入需求文档记录栏。
import type { ModuleParams } from '../shared/types.ts'

/** 切分规则版本:算法或参数口径变化时加一,落盘的旧切分结果据此作废 */
export const MODULE_ALGORITHM_VERSION = 1

/** 同目录偏置边的权重(一条导入记 1,双向互引记 2) */
export const MODULE_FOLDER_AFFINITY = 0.5

/**
 * Louvain 分辨率:越大切出的模块越多、越小。2.5 为本仓库试跑定稿值(约 500 个可分析文件切出 19 个模块,
 * 最大 57 个可分析成员);1 时只有 9 个模块且最大的一个装下 180 个文件,太粗。
 */
export const MODULE_RESOLUTION = 2.5

/** 伪随机种子:固定后同一份代码每次切出同样的模块 */
export const MODULE_SEED = 20261029

/** 成员数低于它的社区并入就近模块 */
export const MODULE_MIN_FILES = 2

export const DEFAULT_MODULE_PARAMS: ModuleParams = {
  resolution: MODULE_RESOLUTION,
  seed: MODULE_SEED,
  folderAffinity: MODULE_FOLDER_AFFINITY,
  minFiles: MODULE_MIN_FILES
}
