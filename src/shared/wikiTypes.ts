// Wiki 跨进程类型:设置、存储标记与稳定常量。页面状态、任务事件在 P3 后续步骤用到时再加,
// 避免先摆一堆没人读的空壳。
export const WIKI_MARKER_FILE = 'codeatlas-wiki.json'
/** 用户选的文件夹已有别的内容且没有应用标记时,写到这里,不跟用户文件混在一起 */
export const WIKI_SUBDIRECTORY = 'CodeAtlasWiki'
/** 语种代号取 src/shared/translateLangs.ts 的 code;默认简体中文 */
export const DEFAULT_WIKI_LANGUAGE = 'zh-CN'

export interface WikiSettings {
  /** 用户手选的 Wiki 根;从没选过为 null,不预填、不提供默认路径 */
  location: string | null
  /** 生成语种代号,必须能对上 translateLangs */
  language: string
  /** 用户是否已确认过位置;由 location 是否存在推出,不单独存矛盾状态 */
  hasChosenLocation: boolean
}
