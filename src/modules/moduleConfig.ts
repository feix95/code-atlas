// 模块切分参数的唯一来源;调参只改这里,定稿值同步记入需求文档记录栏。
import type { ModuleParams } from '../shared/types.ts'

/** 切分规则版本:算法或参数口径变化时加一,落盘的旧切分结果据此作废 */
export const MODULE_ALGORITHM_VERSION = 3

/**
 * 同目录偏置边的权重(一条冷门文件间的导入记 1;公共文件的导入按入度降权,见 communities.ts 的 hubWeight)。
 * 2 为本仓库扫参定稿值:0.5 时 21 个模块里 17 个的成员横跨 3 个以上目录,文件夹几乎不起作用;
 * 2 时只剩 6 个,且删掉一个冷门文件重切时模块 id 与成员几乎不动。
 */
export const MODULE_FOLDER_AFFINITY = 2

/**
 * Louvain 分辨率:越大切出的模块越多、越小。3.5 与 MODULE_FOLDER_AFFINITY = 2 搭配为本仓库扫参定稿值
 * (约 500 个可分析文件切出 20 个模块,最大 64 个成员);同一偏置下 3 只有 16 个模块、最大 74 个,
 * 4 起删一个文件就有三四个模块 id 跟着变。扫参表记在需求文档记录栏。
 */
export const MODULE_RESOLUTION = 3.5

/** 伪随机种子:固定后同一份代码每次切出同样的模块 */
export const MODULE_SEED = 20261029

/** 成员数低于它的社区并入就近模块 */
export const MODULE_MIN_FILES = 2

/**
 * 公共文件门槛:入度大于 max(MODULE_HUB_MIN_IN_DEGREE, MODULE_HUB_SHARE × 有入度的文件数) 的文件不参与社区发现,
 * 分完按目录放回。按比例定门槛,大项目小项目都适用;保底 10 防止小项目里被引用几次的文件也被请出去。
 * 2026-10-29 定稿;本仓库约 430 个有入度文件,门槛约 22,请出 6 个公共文件。
 */
export const MODULE_HUB_MIN_IN_DEGREE = 10
export const MODULE_HUB_SHARE = 0.05

export const DEFAULT_MODULE_PARAMS: ModuleParams = {
  resolution: MODULE_RESOLUTION,
  seed: MODULE_SEED,
  folderAffinity: MODULE_FOLDER_AFFINITY,
  minFiles: MODULE_MIN_FILES,
  hubMinInDegree: MODULE_HUB_MIN_IN_DEGREE,
  hubShare: MODULE_HUB_SHARE
}

/**
 * 自测文件的路径特征。自测会同时引用很多被测文件,参与社区发现会把无关模块错连在一起;
 * 命中的文件不参与切分,分完再挂到它导入最多的模块下(侧栏可显示为「相关测试」)。
 * 覆盖本项目的 selftest-*、JS/TS 的 *.test.* / *.spec.* 与 __tests__/、通用的 tests/ test/ e2e/ 目录、
 * Go 的 *_test.go、Python 的 test_*.py / *_test.py、C# / Java / Kotlin 的 *Test(s).cs|java|kt。
 */
export const MODULE_TEST_FILE_PATTERNS: readonly RegExp[] = [
  /(^|\/)selftest-[^/]+$/,
  /\.(test|spec)\.[^/]+$/,
  /(^|\/)(__tests__|tests?|e2e)\//,
  /_test\.(go|py)$/,
  /(^|\/)test_[^/]+\.py$/,
  /[a-z0-9]Tests?\.(cs|java|kt|kts|scala)$/
]

/** 只有代码文件才算自测:tests/ 下的数据夹具、openapi.spec.json 这类文件按普通文件就近归属 */
export const MODULE_TEST_CODE_EXT =
  /\.([cm]?[jt]sx?|py|go|rs|java|kt|kts|scala|cs|rb|php|swift|vue|svelte)$/
