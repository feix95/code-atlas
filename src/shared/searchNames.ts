/**
 * 工作区文件名深搜(UI v3 §7.2)的主/渲染进程共用契约。
 * 范围 = workspace 根向下深扫磁盘(含从未点开过的目录),文件名/文件夹名含关键字即命中;
 * 遍历沿用扫描器的忽略名单与 MAX_DEPTH/MAX_NODES 保护闸(src/scanner/searchNames.ts)。
 */

/** 结果上限【小葵点头】:超出只回前 N 条,界面在清单末尾垫提示 */
export const SEARCH_NAMES_MAX = 200

export interface SearchNameHit {
  kind: 'file' | 'directory'
  /** 命中项自己的名字(清单行主文) */
  name: string
  /** 全项目相对路径('/' 分隔,根名不进路径 —— 与树节点同一契约) */
  relPath: string
  /** 所在目录的相对路径;根下命中为 ''(清单行次文,如 'src/domain/') */
  dirRel: string
  /** 绝对路径(文件夹命中「打开为工作区」直接拿它扫) */
  absPath: string
}

export interface SearchNamesResult {
  hits: SearchNameHit[]
  /** 到 SEARCH_NAMES_MAX 截断 */
  truncated: boolean
  /** 保护闸(MAX_DEPTH/MAX_NODES)挡住了继续深探 —— 清单只是前半程的账,照实说 */
  stoppedEarly: boolean
  /** 这次搜索被更新的请求顶掉(主进程最新有效制),渲染层拿到直接扔 */
  cancelled: boolean
}
